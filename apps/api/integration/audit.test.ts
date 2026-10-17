import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { createDatabaseClient, recordAudit } from '@atendente/database';
import { createApplication } from '../src/bootstrap';
import { tokenHash } from '../src/auth/auth.service';
const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).pathname !== '/task002_test' ||
  connection !== process.env.DATABASE_URL
)
  throw new Error('Use pnpm db:test.');
test('TASK-030: auditoria transacional, filtros, RBAC, imutabilidade e isolamento HTTP', async (t) => {
  const db = createDatabaseClient(connection),
    app = await createApplication();
  try {
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const a = await db.tenant.create({
        data: { name: 'Audit A', status: 'ACTIVE', timezone: 'UTC' },
      }),
      b = await db.tenant.create({
        data: { name: 'Audit B', status: 'ACTIVE', timezone: 'UTC' },
      });
    async function identity(tenantId: string, role: string) {
      const user = await db.user.create({
        data: {
          name: 'Ana',
          email: `${randomUUID()}@test.local`,
          passwordHash: 'not-login',
          memberships: { create: { tenantId, role } },
        },
      });
      const token = randomBytes(32).toString('base64url');
      await db.authSession.create({
        data: {
          userId: user.id,
          activeTenantId: tenantId,
          tokenHash: tokenHash(token),
          expiresAt: new Date(Date.now() + 600000),
        },
      });
      return { user, cookie: `atendente_session=${token}` };
    }
    const admin = await identity(a.id, 'CLINIC_ADMIN'),
      agent = await identity(a.id, 'AGENT'),
      superAdmin = await identity(a.id, 'SUPER_ADMIN');
    const foreign = await recordAudit(db, {
      data: {
        tenantId: b.id,
        resourceId: b.id,
        type: 'TENANT_UPDATED',
        changes: { after: { status: 'ACTIVE' } },
      },
    });
    const resource = randomUUID();
    const correlationId = randomUUID();
    const audit = await recordAudit(db, {
      data: {
        tenantId: a.id,
        userId: admin.user.id,
        resourceId: resource,
        type: 'APPOINTMENT_CANCELLED',
        correlationId,
        changes: {
          from: 'CONFIRMED',
          to: 'CANCELLED',
          secret: 'must-not-appear',
        },
      },
    });
    const get = (path: string, cookie = admin.cookie) =>
      fetch(url + path, { headers: { cookie } });
    const list = async (path: string) =>
      (await (await get(path)).json()) as { items: { id: string }[] };
    await t.test(
      '403 sem audit.view; SUPER_ADMIN não ganha bypass',
      async () => {
        assert.equal((await get('/audit', agent.cookie)).status, 403);
        assert.equal((await get('/audit', superAdmin.cookie)).status, 403);
      },
    );
    await t.test(
      'detalhe sanitizado, ator real e tenant externo indistinguível de inexistente',
      async () => {
        const response = await get(`/audit/${audit.id}`);
        assert.equal(response.status, 200);
        const body = (await response.json()) as Record<string, unknown>;
        assert.equal(body.actorUserId, admin.user.id);
        assert.equal(body.actorType, 'USER');
        assert.equal(body.source, 'WEB');
        assert.deepEqual(body.previousValues, { status: 'CONFIRMED' });
        assert.deepEqual(body.newValues, { status: 'CANCELLED' });
        assert(!JSON.stringify(body).includes('must-not-appear'));
        assert(!('tenantId' in body));
        assert.equal((await get(`/audit/${foreign.id}`)).status, 404);
        assert.equal((await get(`/audit/${randomUUID()}`)).status, 404);
      },
    );
    await t.test(
      'filtros estruturados, tenant obrigatório, período e paginação',
      async () => {
        for (const filter of [
          `resourceId=${resource}`,
          `action=APPOINTMENT_CANCELLED`,
          `actorUserId=${admin.user.id}`,
          `actorType=USER`,
          `source=WEB`,
          `resourceType=APPOINTMENT`,
          `correlationId=${correlationId}`,
        ]) {
          const body = await list('/audit?' + filter);
          assert(body.items.some((r: { id: string }) => r.id === audit.id));
          assert(body.items.every((r: { id: string }) => r.id !== foreign.id));
        }
        assert.deepEqual((await list(`/audit?resourceId=${b.id}`)).items, []);
        assert.deepEqual(
          (await list(`/audit?correlationId=${foreign.correlationId}`)).items,
          [],
        );
        assert.deepEqual(
          (await list('/audit?dateFrom=2099-01-01T00:00:00Z')).items,
          [],
        );
        const newer = await recordAudit(db, {
          data: {
            tenantId: a.id,
            resourceId: a.id,
            type: 'TENANT_UPDATED',
            changes: { after: { status: 'ACTIVE' } },
          },
        });
        const page = await list('/audit?limit=1');
        assert.equal(page.items[0]!.id, newer.id);
        const secondPage = await list('/audit?limit=1&page=2');
        assert.equal(secondPage.items[0]!.id, audit.id);
        assert.equal(page.items.length, 1);
        assert.equal((await get(`/audit?tenantId=${b.id}`)).status, 400);
        assert.equal((await get('/audit?limit=1000')).status, 400);
      },
    );
    await t.test(
      'somente GET e histórico preservado ao inativar ator',
      async () => {
        for (const method of ['POST', 'PATCH', 'DELETE']) {
          const response = await fetch(url + `/audit/${audit.id}`, {
            method,
            headers: { cookie: admin.cookie, Origin: process.env.AUTH_ORIGIN! },
          });
          assert.notEqual(response.status, 200);
          assert.notEqual(response.status, 201);
        }
        await db.user.update({
          where: { id: admin.user.id },
          data: { status: 'DISABLED' },
        });
        assert(await db.authEvent.findUnique({ where: { id: audit.id } }));
        await db.user.update({
          where: { id: admin.user.id },
          data: { status: 'ACTIVE' },
        });
      },
    );
    await t.test(
      'mutação e auditoria rollback juntas, inclusive falha no audit',
      async () => {
        const before = await db.tenant.findUniqueOrThrow({
          where: { id: a.id },
        });
        const count = await db.authEvent.count({ where: { tenantId: a.id } });
        await assert.rejects(
          db.$transaction(async (tx) => {
            await tx.tenant.update({
              where: { id: a.id },
              data: { name: 'rollback' },
            });
            await recordAudit(tx, {
              data: {
                tenantId: a.id,
                resourceId: a.id,
                type: 'TENANT_UPDATED',
              },
            });
            throw new Error('rollback');
          }),
        );
        await assert.rejects(
          db.$transaction(async (tx) => {
            await tx.tenant.update({
              where: { id: a.id },
              data: { name: 'rollback' },
            });
            await recordAudit(tx, {
              data: {
                tenantId: a.id,
                userId: randomUUID(),
                resourceId: a.id,
                type: 'TENANT_UPDATED',
              },
            });
          }),
        );
        assert.equal(
          (await db.tenant.findUniqueOrThrow({ where: { id: a.id } })).name,
          before.name,
        );
        assert.equal(
          await db.authEvent.count({ where: { tenantId: a.id } }),
          count,
        );
      },
    );
  } finally {
    await app.close();
    await db.$disconnect();
  }
});
