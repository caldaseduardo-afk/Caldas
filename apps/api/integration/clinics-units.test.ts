import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { createDatabaseClient, type Prisma } from '@atendente/database';
import { createApplication } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { tokenHash } from '../src/auth/auth.service';
import type { AuthRequest } from '../src/auth/auth.guard';
import type { DatabaseService } from '../src/auth/database.service';
import { TenantContext } from '../src/tenancy/tenant.context';
import { AuthorizationService } from '../src/permissions/authorization.service';
import { ClinicRepository } from '../src/clinics/clinic.repository';
import { ClinicsService } from '../src/clinics/clinics.service';
import { UnitRepository } from '../src/units/unit.repository';
import { UnitsService } from '../src/units/units.service';
import { provisionDevelopmentClinic } from '../src/clinics/development-provisioning';

const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).pathname !== '/task002_test' ||
  connection !== process.env.DATABASE_URL
)
  throw new Error('Use pnpm db:test.');

test('clínicas/unidades: cadastro, alteração, inativação, auditoria e isolamento', async (t) => {
  const client = createDatabaseClient(connection);
  const app = await createApplication();
  try {
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const origin = process.env.AUTH_ORIGIN!;
    const password = 'senha longa fixture clinics';
    const passwordHash = await hashPassword(password);
    const users = [];
    for (let i = 0; i < 3; i++)
      users.push(
        await client.user.create({
          data: {
            email: `${randomUUID()}@example.test`,
            name: `Clinic ${i}`,
            passwordHash,
          },
        }),
      );
    const [adminA, adminB, reader] = users as [
      (typeof users)[number],
      (typeof users)[number],
      (typeof users)[number],
    ];
    const clinicA = await provisionDevelopmentClinic(
      client,
      'development',
      adminA.email,
      { name: 'Clínica A', timezone: 'America/Sao_Paulo' },
    );
    const clinicB = await provisionDevelopmentClinic(
      client,
      'development',
      adminB.email,
      { name: 'Clínica B', timezone: 'UTC' },
    );
    // Estes cenários cobrem múltiplas unidades, acima do limite BASIC.
    await client.tenantSubscription.updateMany({
      where: { tenantId: { in: [clinicA.id, clinicB.id] } },
      data: { planCode: 'PRO' },
    });
    await client.userTenant.createMany({
      data: [
        { userId: reader.id, tenantId: clinicA.id, role: 'AGENT' },
        { userId: adminA.id, tenantId: clinicB.id, role: 'AGENT' },
      ],
    });
    await client.authThrottle.deleteMany();
    const request = (
      path: string,
      cookie = '',
      method = 'GET',
      body?: unknown,
      extra: Record<string, string> = {},
    ) =>
      fetch(`${url}${path}`, {
        method,
        headers: {
          Cookie: cookie,
          Origin: origin,
          'Content-Type': 'application/json',
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const login = async (email: string, tenantId: string) => {
      const response = await request('/auth/login', '', 'POST', {
        email,
        password,
      });
      assert.equal(response.status, 200);
      const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
      assert.equal(
        (await request('/tenancy/active', cookie, 'POST', { tenantId })).status,
        200,
      );
      return cookie;
    };
    const cookieA = await login(adminA.email, clinicA.id);
    const cookieB = await login(adminB.email, clinicB.id);
    const cookieReader = await login(reader.email, clinicA.id);
    let unitA = '';
    let unitB = '';

    await t.test(
      'provisiona clínica com vínculo e auditoria; API não provisiona plataforma',
      async () => {
        assert.equal(
          (
            await request('/clinics', cookieA, 'POST', {
              name: 'Outra',
              timezone: 'UTC',
            })
          ).status,
          404,
        );
        const membership = await client.userTenant.findUniqueOrThrow({
          where: {
            userId_tenantId: { userId: adminA.id, tenantId: clinicA.id },
          },
        });
        assert.equal(membership.role, 'CLINIC_ADMIN');
        assert.equal(
          await client.authEvent.count({
            where: {
              tenantId: clinicA.id,
              type: 'TENANT_CREATED',
              resourceId: clinicA.id,
            },
          }),
          1,
        );
        const count = await client.tenant.count();
        await assert.rejects(
          provisionDevelopmentClinic(client, 'production', adminA.email, {
            name: 'Inválida',
            timezone: 'UTC',
          }),
        );
        await assert.rejects(
          provisionDevelopmentClinic(
            client,
            'development',
            'missing@example.test',
            { name: 'Inválida', timezone: 'UTC' },
          ),
        );
        assert.equal(await client.tenant.count(), count);
      },
    );
    await t.test(
      'múltiplas unidades; timezone herdado e sobrescrito; atualização de clínica',
      async () => {
        const first = await request('/units', cookieA, 'POST', {
          name: 'Unidade A1',
          address: 'Rua A',
        });
        assert.equal(first.status, 201);
        const firstData = (await first.json()) as {
          id: string;
          tenantId: string;
          active: boolean;
        };
        unitA = firstData.id;
        assert.equal(firstData.tenantId, clinicA.id);
        assert.equal(firstData.active, true);
        assert.equal(
          (
            await request('/units', cookieA, 'POST', {
              name: 'Unidade A2',
              address: 'Rua B',
              timezoneOverride: 'Europe/Lisbon',
            })
          ).status,
          201,
        );
        const other = await request('/units', cookieB, 'POST', {
          name: 'Unidade B1',
          address: 'Rua C',
        });
        assert.equal(other.status, 201);
        unitB = ((await other.json()) as { id: string }).id;
        const list = (await (await request('/units', cookieA)).json()) as {
          tenantId: string;
          effectiveTimezone: string;
        }[];
        assert.equal(list.length, 2);
        assert.ok(list.every((unit) => unit.tenantId === clinicA.id));
        assert.deepEqual(list.map((unit) => unit.effectiveTimezone).sort(), [
          'America/Sao_Paulo',
          'Europe/Lisbon',
        ]);
        assert.equal(
          (
            await request(`/clinics/${clinicA.id}`, cookieA, 'PATCH', {
              name: 'Clínica A atualizada',
              timezone: 'UTC',
            })
          ).status,
          200,
        );
        assert.equal(
          (
            (await (await request(`/units/${unitA}`, cookieA)).json()) as {
              effectiveTimezone: string;
            }
          ).effectiveTimezone,
          'UTC',
        );
        const clinics = (await (await request('/clinics', cookieA)).json()) as {
          id: string;
        }[];
        assert.deepEqual(
          clinics.map((clinic) => clinic.id),
          [clinicA.id],
        );
      },
    );
    await t.test(
      'DTOs, IDs, mass assignment e CSRF impedem escrita',
      async () => {
        for (const body of [
          { name: 'x' },
          { name: '', address: 'x' },
          { name: 'x', address: 'x', tenantId: clinicB.id },
          { name: 'x', address: 'x', active: 'false' },
          { name: 'x', address: 'x', timezoneOverride: 'Invalid/Zone' },
        ])
          assert.equal(
            (await request('/units', cookieA, 'POST', body)).status,
            400,
          );
        for (const body of [
          {},
          { tenantId: clinicB.id },
          { id: unitB },
          { active: null },
        ])
          assert.equal(
            (await request(`/units/${unitA}`, cookieA, 'PATCH', body)).status,
            400,
          );
        assert.equal(
          (
            await request(`/clinics/${clinicA.id}`, cookieA, 'PATCH', {
              role: 'SUPER_ADMIN',
            })
          ).status,
          400,
        );
        assert.equal((await request('/units/not-uuid', cookieA)).status, 400);
        assert.equal(
          (
            await request(
              `/units/${unitA}`,
              cookieA,
              'PATCH',
              { name: 'CSRF' },
              { Origin: 'https://evil.test' },
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(`/units/${unitA}`, cookieA, 'DELETE', undefined, {
              Origin: '',
            })
          ).status,
          403,
        );
        assert.equal((await request('/units')).status, 401);
      },
    );
    await t.test(
      'roles de leitura não criam/alteram/inativam; privilégio não atravessa vínculo',
      async () => {
        for (const role of ['AGENT', 'DOCTOR']) {
          await client.userTenant.update({
            where: {
              userId_tenantId: { userId: reader.id, tenantId: clinicA.id },
            },
            data: { role },
          });
          assert.equal(
            (await request(`/units/${unitA}`, cookieReader)).status,
            200,
          );
          assert.equal(
            (
              await request('/units', cookieReader, 'POST', {
                name: 'Negada',
                address: 'x',
              })
            ).status,
            403,
          );
          for (const path of [`/units/${unitA}`, `/clinics/${clinicA.id}`]) {
            assert.equal(
              (await request(path, cookieReader, 'PATCH', { name: 'Negada' }))
                .status,
              403,
            );
            assert.equal(
              (await request(path, cookieReader, 'DELETE')).status,
              403,
            );
          }
        }
        assert.equal(
          (
            await request('/tenancy/active', cookieA, 'POST', {
              tenantId: clinicB.id,
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await request('/units', cookieA, 'POST', {
              name: 'Negada',
              address: 'x',
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await request('/tenancy/active', cookieA, 'POST', {
              tenantId: clinicA.id,
            })
          ).status,
          200,
        );
      },
    );
    await t.test(
      'IDs de outro tenant não permitem ler, alterar nem inativar em ambas as direções',
      async () => {
        for (const [cookie, clinic, unit] of [
          [cookieA, clinicB.id, unitB],
          [cookieB, clinicA.id, unitA],
        ]) {
          for (const path of [`/clinics/${clinic}`, `/units/${unit}`]) {
            assert.equal((await request(path!, cookie)).status, 404);
            assert.equal(
              (await request(path!, cookie, 'PATCH', { name: 'Ataque' }))
                .status,
              404,
            );
            assert.equal((await request(path!, cookie, 'DELETE')).status, 404);
          }
        }
        assert.equal(
          (
            await request(
              `/units/${unitB}?tenantId=${clinicB.id}`,
              cookieA,
              'PATCH',
              { name: 'Ataque' },
              { 'X-Tenant-ID': clinicB.id },
            )
          ).status,
          404,
        );
        assert.equal(
          (await client.unit.findUniqueOrThrow({ where: { id: unitB } })).name,
          'Unidade B1',
        );
        assert.equal(
          await client.authEvent.count({
            where: { userId: adminA.id, resourceId: unitB },
          }),
          0,
        );
      },
    );
    await t.test(
      'alteração e inativação preservam unidade e auditoria; override nulo herda timezone',
      async () => {
        assert.equal(
          (
            await request(`/units/${unitA}`, cookieA, 'PATCH', {
              name: 'Unidade alterada',
              address: 'Novo endereço',
              timezoneOverride: 'Asia/Tokyo',
            })
          ).status,
          200,
        );
        assert.equal(
          (
            (await (await request(`/units/${unitA}`, cookieA)).json()) as {
              effectiveTimezone: string;
            }
          ).effectiveTimezone,
          'Asia/Tokyo',
        );
        assert.equal(
          (
            await request(`/units/${unitA}`, cookieA, 'PATCH', {
              timezoneOverride: null,
            })
          ).status,
          200,
        );
        assert.equal(
          (
            (await (await request(`/units/${unitA}`, cookieA)).json()) as {
              effectiveTimezone: string;
            }
          ).effectiveTimezone,
          'UTC',
        );
        assert.equal(
          (await request(`/units/${unitA}`, cookieA, 'DELETE')).status,
          200,
        );
        assert.equal(
          (await client.unit.findUniqueOrThrow({ where: { id: unitA } }))
            .active,
          false,
        );
        const event = await client.authEvent.findFirstOrThrow({
          where: {
            type: 'UNIT_DEACTIVATED',
            tenantId: clinicA.id,
            resourceId: unitA,
          },
        });
        assert.equal(event.userId, adminA.id);
        assert.equal(
          (event.changes as { after: { active: boolean } }).after.active,
          false,
        );
        assert.equal((await request(`/units/${unitA}`, cookieA)).status, 200);
        assert.equal(
          (await request(`/units/${unitA}`, cookieA, 'PATCH', { active: true }))
            .status,
          200,
        );
      },
    );
    await t.test(
      'repository revalida revogação; falha na auditoria desfaz alteração',
      async () => {
        const stored = await client.authSession.findUniqueOrThrow({
          where: { tokenHash: tokenHash(cookieA.split('=')[1]!) },
        });
        const database = { client } as DatabaseService;
        const context = new TenantContext(
          {
            identity: { id: adminA.id, email: adminA.email, name: adminA.name },
            sessionId: stored.id,
            activeTenantId: clinicA.id,
          } as AuthRequest,
          database,
        );
        const authorization = new AuthorizationService(database, context);
        // Mesmo um caller interno com campos extras não pode mover a unidade.
        const untrusted = { name: 'Unidade alterada', tenantId: clinicB.id };
        await new UnitRepository(database, authorization).update(
          unitA,
          untrusted,
        );
        assert.equal(
          (await client.unit.findUniqueOrThrow({ where: { id: unitA } }))
            .tenantId,
          clinicA.id,
        );
        const original = authorization.requirePermissions.bind(authorization);
        authorization.requirePermissions = async (...permissions) => {
          const scope = await original(...permissions);
          await client.userTenant.update({
            where: {
              userId_tenantId: { userId: adminA.id, tenantId: clinicA.id },
            },
            data: { role: 'AGENT' },
          });
          return scope;
        };
        try {
          await assert.rejects(
            new UnitRepository(database, authorization).update(unitA, {
              name: 'Revogada',
            }),
            ForbiddenException,
          );
        } finally {
          await client.userTenant.update({
            where: {
              userId_tenantId: { userId: adminA.id, tenantId: clinicA.id },
            },
            data: { role: 'CLINIC_ADMIN' },
          });
          authorization.requirePermissions = original;
        }
        const failingDatabase = {
          client: {
            $transaction: (
              execute: (tx: Prisma.TransactionClient) => Promise<unknown>,
              options: { isolationLevel: 'Serializable' },
            ) =>
              client.$transaction(
                (tx) =>
                  execute(
                    new Proxy(tx, {
                      get(target, key) {
                        if (key === 'authEvent')
                          return {
                            create: async () => {
                              throw new Error('Falha simulada de auditoria');
                            },
                          };
                        return Reflect.get(target, key);
                      },
                    }),
                  ),
                options,
              ),
          },
        } as unknown as DatabaseService;
        await assert.rejects(
          new UnitRepository(failingDatabase, authorization).update(unitA, {
            name: 'Rollback',
          }),
        );
        assert.equal(
          (await client.unit.findUniqueOrThrow({ where: { id: unitA } })).name,
          'Unidade alterada',
        );
        const empty = new AuthorizationService(
          database,
          new TenantContext({} as AuthRequest, database),
        );
        await assert.rejects(
          new UnitsService(empty, new UnitRepository(database, empty)).create({
            name: 'x',
            address: 'x',
          }),
        );
        await assert.rejects(
          new ClinicsService(
            empty,
            new ClinicRepository(database, empty),
          ).update(clinicA.id, { name: 'x' }),
        );
      },
    );
    await t.test(
      'inativação de clínica bloqueia contexto e mantém histórico e unidades',
      async () => {
        assert.equal(
          (await request(`/clinics/${clinicA.id}`, cookieA, 'DELETE')).status,
          200,
        );
        assert.equal(
          (await client.tenant.findUniqueOrThrow({ where: { id: clinicA.id } }))
            .status,
          'INACTIVE',
        );
        assert.equal((await request('/units', cookieA)).status, 403);
        assert.equal(
          (
            await request(`/clinics/${clinicA.id}`, cookieA, 'PATCH', {
              status: 'ACTIVE',
            })
          ).status,
          403,
        );
        assert.equal((await request('/auth/me', cookieA)).status, 200);
        assert.equal(
          (
            await request('/tenancy/active', cookieA, 'POST', {
              tenantId: clinicA.id,
            })
          ).status,
          403,
        );
        assert.equal(
          await client.unit.count({ where: { tenantId: clinicA.id } }),
          2,
        );
        assert.equal(
          await client.authEvent.count({
            where: {
              tenantId: clinicA.id,
              type: 'TENANT_DEACTIVATED',
              userId: adminA.id,
            },
          }),
          1,
        );
        assert.equal((await request('/units', cookieB)).status, 200);
      },
    );
  } finally {
    await app.close();
    await client.$disconnect();
  }
});
