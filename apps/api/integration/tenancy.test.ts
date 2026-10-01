import { AuthorizationService } from '../src/permissions/authorization.service';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createDatabaseClient } from '@atendente/database';
import { createApplication } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { tokenHash } from '../src/auth/auth.service';
import type { AuthRequest } from '../src/auth/auth.guard';
import type { DatabaseService } from '../src/auth/database.service';
import { TenantContext } from '../src/tenancy/tenant.context';
import { TenantRepository } from '../src/tenancy/tenant.repository';
import { UnitRepository } from '../src/units/unit.repository';

const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).pathname !== '/task002_test' ||
  connection !== process.env.DATABASE_URL
)
  throw new Error('Use pnpm db:test.');

test('isolamento multi-tenant real em HTTP, contexto e repositories', async (t) => {
  const client = createDatabaseClient(connection);
  let app = await createApplication();
  await app.listen(0, '127.0.0.1');
  let url = await app.getUrl();
  const origin = process.env.AUTH_ORIGIN!;
  const password = 'senha longa fixture tenancy';
  const passwordHash = await hashPassword(password);
  const tenantA = await client.tenant.create({
    data: { name: 'Tenant A isolamento', status: 'ACTIVE', timezone: 'UTC' },
  });
  const tenantB = await client.tenant.create({
    data: { name: 'Tenant B isolamento', status: 'ACTIVE', timezone: 'UTC' },
  });
  const unitA = await client.unit.create({
    data: { tenantId: tenantA.id, name: 'Unidade A', address: 'Fictício A' },
  });
  const unitB = await client.unit.create({
    data: { tenantId: tenantB.id, name: 'Unidade B', address: 'Fictício B' },
  });
  const users = [];
  for (let i = 0; i < 3; i++)
    users.push(
      await client.user.create({
        data: {
          email: `${randomUUID()}@example.test`,
          name: `Usuário ${i}`,
          passwordHash,
        },
      }),
    );
  const [userA, userB, multi] = users as [
    (typeof users)[number],
    (typeof users)[number],
    (typeof users)[number],
  ];
  await client.userTenant.createMany({
    data: [
      { userId: userA.id, tenantId: tenantA.id, role: 'CLINIC_ADMIN' },
      { userId: userB.id, tenantId: tenantB.id, role: 'AGENT' },
      { userId: multi.id, tenantId: tenantA.id, role: 'AGENT' },
      { userId: multi.id, tenantId: tenantB.id, role: 'AGENT' },
    ],
  });
  const get = (
    path: string,
    cookie: string,
    extra: Record<string, string> = {},
  ) => fetch(`${url}${path}`, { headers: { Cookie: cookie, ...extra } });
  const select = (cookie: string, tenantId: string, requestOrigin = origin) =>
    fetch(`${url}/tenancy/active`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: requestOrigin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tenantId }),
    });
  const login = async (email: string, previous = '') => {
    const response = await fetch(`${url}/auth/login`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: previous,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!.split(';')[0]!;
  };
  const session = async (cookie: string) =>
    client.authSession.findUniqueOrThrow({
      where: { tokenHash: tokenHash(cookie.split('=')[1]!) },
    });
  await client.authThrottle.deleteMany();
  const cookieA = await login(userA.email);
  const cookieB = await login(userB.email);
  const multiA = await login(multi.email);
  const multiB = await login(multi.email);
  try {
    await t.test(
      'login sem seleção; lista apenas vínculos disponíveis; seleção arbitrária negada',
      async () => {
        assert.equal((await get('/tenancy/active', cookieA)).status, 403);
        assert.equal((await get('/tenancy/units', cookieA)).status, 403);
        assert.deepEqual(
          (
            (await (await get('/tenancy/tenants', cookieA)).json()) as {
              id: string;
            }[]
          ).map((v: { id: string }) => v.id),
          [tenantA.id],
        );
        assert.equal((await select(cookieA, tenantB.id)).status, 403);
        assert.equal((await select(cookieA, randomUUID())).status, 403);
        assert.equal(
          (await select(cookieA, tenantA.id, 'https://evil.test')).status,
          403,
        );
        assert.equal((await session(cookieA)).activeTenantId, null);
        assert.equal((await select(cookieA, tenantA.id)).status, 200);
        assert.equal((await select(cookieB, tenantB.id)).status, 200);
        const event = await client.authEvent.findFirst({
          where: {
            userId: userA.id,
            tenantId: tenantA.id,
            type: 'TENANT_SELECTED',
          },
        });
        assert.ok(event);
        await assert.rejects(
          client.authSession.update({
            where: { id: (await session(cookieA)).id },
            data: { activeTenantId: tenantB.id },
          }),
        );
      },
    );
    await t.test(
      'A não acessa B por ID e B não acessa A; role não cria bypass',
      async () => {
        for (const [cookie, own, other] of [
          [cookieA, unitA, unitB],
          [cookieB, unitB, unitA],
        ] as const) {
          const response = await get(`/tenancy/units/${own.id}`, cookie);
          assert.equal(response.status, 200);
          assert.deepEqual(await response.json(), {
            id: own.id,
            tenantId: own.tenantId,
            name: own.name,
          });
          assert.equal(
            (await get(`/tenancy/units/${other.id}`, cookie)).status,
            404,
          );
          const list = (await (await get('/tenancy/units', cookie)).json()) as {
            id: string;
          }[];
          assert.deepEqual(
            list.map((v: { id: string }) => v.id),
            [own.id],
          );
          for (const method of ['POST', 'PATCH', 'DELETE']) {
            assert.equal(
              (
                await fetch(`${url}/tenancy/units/${other.id}`, {
                  method,
                  headers: {
                    Cookie: cookie,
                    Origin: origin,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    name: 'Ataque',
                    tenantId: other.tenantId,
                  }),
                })
              ).status,
              404,
            );
          }
        }
        assert.equal(
          (await client.unit.findUniqueOrThrow({ where: { id: unitB.id } }))
            .name,
          unitB.name,
        );
      },
    );
    await t.test(
      'header/query não alteram contexto; concorrência não mistura requisições',
      async () => {
        assert.equal(
          (
            await get(
              `/tenancy/units/${unitB.id}?tenantId=${tenantB.id}`,
              cookieA,
              { 'X-Tenant-ID': tenantB.id },
            )
          ).status,
          404,
        );
        const results = await Promise.all(
          Array.from({ length: 12 }, async (_, i) => {
            const expected = i % 2 === 0 ? tenantA : tenantB;
            const response = await get(
              '/tenancy/active',
              i % 2 === 0 ? cookieA : cookieB,
            );
            assert.equal(response.status, 200);
            assert.equal(
              ((await response.json()) as { id: string }).id,
              expected.id,
            );
          }),
        );
        assert.equal(results.length, 12);
      },
    );
    await t.test(
      'múltiplos vínculos exigem seleção e sessões permanecem independentes',
      async () => {
        assert.equal((await get('/tenancy/active', multiA)).status, 403);
        assert.equal((await select(multiA, tenantA.id)).status, 200);
        assert.equal((await select(multiB, tenantB.id)).status, 200);
        assert.equal(
          (await get(`/tenancy/units/${unitB.id}`, multiA)).status,
          404,
        );
        assert.equal(
          (await get(`/tenancy/units/${unitA.id}`, multiB)).status,
          404,
        );
        assert.equal((await select(multiA, tenantB.id)).status, 200);
        assert.equal(
          (await get(`/tenancy/units/${unitB.id}`, multiA)).status,
          200,
        );
        assert.equal((await select(multiA, tenantA.id)).status, 200);
        assert.equal(
          (
            (await (await get('/tenancy/active', multiB)).json()) as {
              id: string;
            }
          ).id,
          tenantB.id,
        );
      },
    );
    await t.test(
      'tenant selecionado persiste após reinício; login novo não herda seleção',
      async () => {
        await app.close();
        app = await createApplication();
        await app.listen(0, '127.0.0.1');
        url = await app.getUrl();
        assert.equal(
          (
            (await (await get('/tenancy/active', cookieA)).json()) as {
              id: string;
            }
          ).id,
          tenantA.id,
        );
        const fresh = await login(userA.email);
        assert.equal((await get('/auth/me', fresh)).status, 200);
        assert.equal((await get('/tenancy/active', fresh)).status, 403);
      },
    );
    await t.test(
      'revogação e tenant inativo bloqueiam imediatamente sem bloquear logout/seleção',
      async () => {
        await client.userTenant.update({
          where: {
            userId_tenantId: { userId: userA.id, tenantId: tenantA.id },
          },
          data: { active: false },
        });
        assert.equal((await get('/tenancy/units', cookieA)).status, 403);
        assert.equal((await select(cookieA, tenantA.id)).status, 403);
        assert.deepEqual(
          await (await get('/tenancy/tenants', cookieA)).json(),
          [],
        );
        assert.equal((await get('/auth/me', cookieA)).status, 200);
        await client.userTenant.update({
          where: {
            userId_tenantId: { userId: userA.id, tenantId: tenantA.id },
          },
          data: { active: true },
        });
        await client.tenant.update({
          where: { id: tenantA.id },
          data: { status: 'INACTIVE' },
        });
        assert.equal((await get('/tenancy/active', cookieA)).status, 403);
        assert.equal((await select(cookieA, tenantA.id)).status, 403);
        await client.tenant.update({
          where: { id: tenantA.id },
          data: { status: 'ACTIVE' },
        });
      },
    );
    await t.test(
      'repositories revalidam snapshot e revogação na própria consulta',
      async () => {
        const stored = await session(multiA);
        const request = {
          identity: { id: multi.id, email: multi.email, name: multi.name },
          sessionId: stored.id,
          activeTenantId: tenantA.id,
        } as AuthRequest;
        const database = { client } as DatabaseService;
        const context = new TenantContext(request, database);
        const units = new UnitRepository(
          database,
          new AuthorizationService(database, context),
        );
        assert.equal((await units.findById(unitA.id)).id, unitA.id);
        assert.equal((await select(multiA, tenantB.id)).status, 200);
        await assert.rejects(units.findById(unitA.id));
        await assert.rejects(units.findById(unitB.id));
        assert.equal((await select(multiA, tenantA.id)).status, 200);
        const original = context.requireTenant.bind(context);
        context.requireTenant = async () => {
          const scope = await original();
          await client.userTenant.update({
            where: {
              userId_tenantId: { userId: multi.id, tenantId: tenantA.id },
            },
            data: { active: false },
          });
          return scope;
        };
        await assert.rejects(units.findById(unitA.id));
        await client.userTenant.update({
          where: {
            userId_tenantId: { userId: multi.id, tenantId: tenantA.id },
          },
          data: { active: true },
        });
        const forged = new TenantContext(
          { ...request, activeTenantId: tenantB.id } as AuthRequest,
          database,
        );
        await assert.rejects(
          new TenantRepository(
            database,
            forged,
            new AuthorizationService(database, forged),
          ).current(),
        );
      },
    );
    await t.test(
      'remover vínculo revoga sessões associadas, sem afetar outro tenant',
      async () => {
        await client.userTenant.delete({
          where: {
            userId_tenantId: { userId: multi.id, tenantId: tenantA.id },
          },
        });
        assert.equal((await get('/auth/me', multiA)).status, 401);
        assert.equal((await get('/tenancy/active', multiB)).status, 200);
      },
    );
  } finally {
    await app.close();
    await client.$disconnect();
  }
});
