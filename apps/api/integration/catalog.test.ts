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
import { SpecialtyRepository } from '../src/catalog/specialty.repository';
import { ServiceRepository } from '../src/catalog/service.repository';
import { SpecialtiesService } from '../src/catalog/specialties.service';
import { ServicesService } from '../src/catalog/services.service';

const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).pathname !== '/task002_test' ||
  connection !== process.env.DATABASE_URL
)
  throw new Error('Use pnpm db:test.');
interface Specialty {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
}
interface Service extends Specialty {
  specialtyId: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  price: string | null;
}

test('especialidades e serviços: catálogo, dinheiro exato, RBAC e isolamento real', async (t) => {
  const client = createDatabaseClient(connection);
  const app = await createApplication();
  try {
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const aTenant = await client.tenant.create({
      data: { name: 'Catálogo A', status: 'ACTIVE', timezone: 'UTC' },
    });
    const bTenant = await client.tenant.create({
      data: { name: 'Catálogo B', status: 'ACTIVE', timezone: 'UTC' },
    });
    const password = 'senha longa catalogo teste';
    const passwordHash = await hashPassword(password);
    const users: { id: string; email: string; name: string }[] = [];
    for (const [tenantId, role] of [
      [aTenant.id, 'CLINIC_ADMIN'],
      [bTenant.id, 'CLINIC_ADMIN'],
      [aTenant.id, 'AGENT'],
      [aTenant.id, 'DOCTOR'],
    ] as const)
      users.push(
        await client.user.create({
          data: {
            name: role,
            email: `${randomUUID()}@example.test`,
            passwordHash,
            memberships: { create: { tenantId, role } },
          },
        }),
      );
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
          Origin: process.env.AUTH_ORIGIN!,
          'Content-Type': 'application/json',
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    await client.authThrottle.deleteMany();
    const login = async (index: number, tenantId: string) => {
      const response = await request('/auth/login', '', 'POST', {
        email: users[index]!.email,
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
    const a = await login(0, aTenant.id),
      b = await login(1, bTenant.id),
      agent = await login(2, aTenant.id),
      doctor = await login(3, aTenant.id);
    const createSpecialty = async (name: string, cookie = a) => {
      const response = await request('/specialties', cookie, 'POST', {
        name,
        description: 'Área de atendimento',
      });
      assert.equal(response.status, 201, await response.clone().text());
      return (await response.json()) as Specialty;
    };
    const createService = async (
      specialtyId: string,
      cookie = a,
      extra: Record<string, unknown> = {},
    ) => {
      const response = await request('/services', cookie, 'POST', {
        specialtyId,
        name: 'Primeira consulta',
        durationMinutes: 30,
        bufferBeforeMinutes: 5,
        bufferAfterMinutes: 10,
        price: '150.10',
        ...extra,
      });
      assert.equal(response.status, 201, await response.clone().text());
      return (await response.json()) as Service;
    };
    let sa: Specialty,
      sb: Specialty,
      second: Specialty,
      va: Service,
      vb: Service;
    await t.test(
      'cria Specialty/Service distintos; nomes equivalentes entre tenants e projeções mínimas',
      async () => {
        sa = await createSpecialty('Cardiologia');
        sb = await createSpecialty('Cardiologia', b);
        second = await createSpecialty('Dermatologia');
        va = await createService(sa.id);
        vb = await createService(sb.id, b);
        assert.notEqual(sa.id, va.id);
        assert.equal(va.specialtyId, sa.id);
        assert.equal(vb.specialtyId, sb.id);
        assert.equal(va.durationMinutes, 30);
        assert.equal(va.price, '150.10');
        assert.deepEqual(Object.keys(sa).sort(), [
          'active',
          'description',
          'id',
          'name',
        ]);
        assert.deepEqual(Object.keys(va).sort(), [
          'active',
          'bufferAfterMinutes',
          'bufferBeforeMinutes',
          'description',
          'durationMinutes',
          'id',
          'name',
          'price',
          'specialtyId',
        ]);
        assert.equal((await request(`/specialties/${sa.id}`, a)).status, 200);
        assert.equal((await request(`/services/${va.id}`, a)).status, 200);
        const list = (await (
          await request('/services', a)
        ).json()) as Service[];
        assert.deepEqual(
          list.map((x) => x.id),
          [va.id],
        );
        const specialties = (await (
          await request('/specialties', a)
        ).json()) as Specialty[];
        assert.deepEqual(
          specialties.map((x) => x.id).sort(),
          [sa.id, second.id].sort(),
        );
      },
    );
    await t.test(
      'unicidade local respeita especialidade e inativação não libera nomes',
      async () => {
        assert.equal(
          (await request('/specialties', a, 'POST', { name: ' Cardiologia ' }))
            .status,
          409,
        );
        assert.equal(
          (
            await request('/services', a, 'POST', {
              specialtyId: sa.id,
              name: 'Primeira consulta',
              durationMinutes: 30,
            })
          ).status,
          409,
        );
        const equivalent = await createService(second.id);
        assert.notEqual(equivalent.id, va.id);
        assert.equal(
          (
            await request(`/specialties/${sa.id}`, a, 'PATCH', {
              active: false,
            })
          ).status,
          200,
        );
        assert.equal(
          (await request('/specialties', a, 'POST', { name: 'Cardiologia' }))
            .status,
          409,
        );
        assert.equal(
          (await request(`/specialties/${sa.id}`, a, 'PATCH', { active: true }))
            .status,
          200,
        );
      },
    );
    await t.test(
      'duração positiva, buffers não negativos e DTOs obrigatórios em criação/atualização',
      async () => {
        for (const invalid of [
          { durationMinutes: 0 },
          { durationMinutes: -1 },
          { durationMinutes: 0.1 },
          { durationMinutes: '30' },
          { bufferBeforeMinutes: -1 },
          { bufferAfterMinutes: -1 },
          { price: '-0.01' },
          { price: -1 },
          { tenantId: bTenant.id },
          { active: 'false' },
        ]) {
          assert.equal(
            (
              await request('/services', a, 'POST', {
                name: randomUUID(),
                specialtyId: sa.id,
                durationMinutes: 30,
                ...invalid,
              })
            ).status,
            400,
          );
          assert.equal(
            (await request(`/services/${va.id}`, a, 'PATCH', invalid)).status,
            400,
          );
        }
        for (const body of [
          {},
          { name: 'Falta duração', specialtyId: sa.id },
          { name: 'Falta especialidade', durationMinutes: 30 },
        ])
          assert.equal(
            (await request('/services', a, 'POST', body)).status,
            400,
          );
        assert.equal(
          (
            await request('/specialties', a, 'POST', {
              name: 'x',
              tenantId: bTenant.id,
            })
          ).status,
          400,
        );
        assert.equal(
          (await request(`/specialties/${sa.id}`, a, 'PATCH', { id: sb.id }))
            .status,
          400,
        );
        assert.equal((await request('/services/not-a-uuid', a)).status, 400);
      },
    );
    await t.test(
      'IDs externos/inexistentes não revelam dados nem permitem escrita ou inativação',
      async () => {
        for (const [collection, foreignId] of [
          ['specialties', sb.id],
          ['services', vb.id],
        ]) {
          const absent = await request(`/${collection}/${randomUUID()}`, a);
          const foreign = await request(`/${collection}/${foreignId}`, a);
          assert.equal(foreign.status, 404);
          assert.deepEqual(await foreign.json(), await absent.json());
          for (const payload of [
            { name: 'Ataque' },
            { active: false },
            { active: true },
          ])
            assert.equal(
              (
                await request(
                  `/${collection}/${foreignId}`,
                  a,
                  'PATCH',
                  payload,
                )
              ).status,
              404,
            );
          assert.equal(
            (
              await request(
                `/${collection}/${foreignId}`,
                a,
                'GET',
                undefined,
                { 'X-Tenant-ID': bTenant.id },
              )
            ).status,
            404,
          );
        }
        for (const specialtyId of [sb.id, randomUUID()]) {
          assert.equal(
            (
              await request('/services', a, 'POST', {
                name: 'Ataque',
                specialtyId,
                durationMinutes: 30,
              })
            ).status,
            404,
          );
          assert.equal(
            (await request(`/services/${va.id}`, a, 'PATCH', { specialtyId }))
              .status,
            404,
          );
          assert.equal(
            (await request(`/services?specialtyId=${specialtyId}`, a)).status,
            404,
          );
        }
        assert.equal((await request(`/services/${va.id}`, b)).status, 404);
        assert.equal((await request(`/specialties/${sa.id}`, b)).status, 404);
        assert.equal(
          (await client.service.findUniqueOrThrow({ where: { id: va.id } }))
            .specialtyId,
          sa.id,
        );
        assert.equal(
          (await client.service.findUniqueOrThrow({ where: { id: vb.id } }))
            .active,
          true,
        );
      },
    );
    await t.test(
      'atualiza e reatribui serviço somente dentro do tenant; filtros mantêm isolamento',
      async () => {
        assert.equal(
          (
            await request(`/specialties/${sa.id}`, a, 'PATCH', {
              name: 'Cardiologia atualizada',
              description: null,
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await request(`/services/${va.id}`, a, 'PATCH', {
              name: 'Retorno',
              durationMinutes: 15,
              bufferBeforeMinutes: 0,
              bufferAfterMinutes: 5,
              description: 'Atendimento concreto',
            })
          ).status,
          200,
        );
        const unchanged = (await (
          await request(`/services/${va.id}`, a)
        ).json()) as Service;
        assert.equal(unchanged.specialtyId, sa.id);
        assert.equal(unchanged.durationMinutes, 15);
        assert.equal(
          (
            await request(`/services/${va.id}`, a, 'PATCH', {
              specialtyId: second.id,
            })
          ).status,
          200,
        );
        assert.deepEqual(
          await (await request(`/services?specialtyId=${sa.id}`, a)).json(),
          [],
        );
        const filtered = (await (
          await request(`/services?specialtyId=${second.id}`, a)
        ).json()) as Service[];
        assert.equal(filtered.length, 2);
        assert.ok(filtered.every((x) => x.specialtyId === second.id));
        const bList = (await (
          await request(`/services?specialtyId=${sb.id}`, b)
        ).json()) as Service[];
        assert.deepEqual(
          bList.map((x) => x.id),
          [vb.id],
        );
        for (const path of [
          '/services?active=maybe',
          '/services?active=true&active=false',
          '/services?tenantId=x',
          '/services?specialtyId=x',
          `/specialties?specialtyId=${sa.id}`,
        ])
          assert.equal((await request(path, a)).status, 400);
      },
    );
    await t.test(
      'inativação/ativação preserva registros e não modifica serviços implicitamente',
      async () => {
        const count = await client.service.count();
        assert.equal(
          (
            await request(`/specialties/${second.id}`, a, 'PATCH', {
              active: false,
            })
          ).status,
          200,
        );
        assert.equal(
          (await client.service.findUniqueOrThrow({ where: { id: va.id } }))
            .active,
          true,
        );
        assert.equal(
          (await request(`/services/${va.id}`, a, 'PATCH', { active: false }))
            .status,
          200,
        );
        const inactive = (await (
          await request('/services?active=false', a)
        ).json()) as Service[];
        assert.deepEqual(
          inactive.map((x) => x.id),
          [va.id],
        );
        const active = (await (
          await request('/services?active=true', a)
        ).json()) as Service[];
        assert.ok(active.every((x) => x.active && x.id !== va.id));
        assert.deepEqual(
          (
            (await (
              await request('/specialties?active=false', a)
            ).json()) as Specialty[]
          ).map((x) => x.id),
          [second.id],
        );
        assert.equal((await request(`/services/${va.id}`, a)).status, 200);
        assert.equal(
          (await request(`/services/${va.id}`, a, 'PATCH', { active: true }))
            .status,
          200,
        );
        assert.equal(
          (
            await request(`/specialties/${second.id}`, a, 'PATCH', {
              active: true,
            })
          ).status,
          200,
        );
        assert.equal(await client.service.count(), count);
        assert.equal(
          await client.specialty.count({ where: { tenantId: aTenant.id } }),
          2,
        );
      },
    );
    await t.test(
      'dinheiro Decimal mantém precisão, zero, limite e ausência sem float',
      async () => {
        for (const [input, expected] of [
          ['0.1', '0.10'],
          ['9999999999.99', '9999999999.99'],
          ['0', '0.00'],
          ['1234567890.12', '1234567890.12'],
        ]) {
          const response = await request(`/services/${va.id}`, a, 'PATCH', {
            price: input,
          });
          assert.equal(response.status, 200);
          assert.equal(((await response.json()) as Service).price, expected);
          assert.equal(
            (
              await client.service.findUniqueOrThrow({ where: { id: va.id } })
            ).price!.toFixed(2),
            expected,
          );
          assert.equal(
            ((await (await request(`/services/${va.id}`, a)).json()) as Service)
              .price,
            expected,
          );
        }
        for (const price of ['1.001', '10000000000.00', '1e2', 0.1])
          assert.equal(
            (await request(`/services/${va.id}`, a, 'PATCH', { price })).status,
            400,
          );
        assert.equal(
          (await request(`/services/${va.id}`, a, 'PATCH', { price: null }))
            .status,
          200,
        );
        assert.equal(
          ((await (await request(`/services/${va.id}`, a)).json()) as Service)
            .price,
          null,
        );
        const response = await request('/services', a, 'POST', {
          name: 'Sem preço',
          specialtyId: sa.id,
          durationMinutes: 1,
        });
        assert.equal(response.status, 201);
        const defaults = (await response.json()) as Service;
        assert.equal(defaults.price, null);
        assert.equal(defaults.bufferBeforeMinutes, 0);
        assert.equal(defaults.bufferAfterMinutes, 0);
        assert.equal(defaults.active, true);
      },
    );
    await t.test(
      'RBAC em todas as rotas, CSRF e revogação de permissão sem novo login',
      async () => {
        for (const [collection, id] of [
          ['specialties', sa.id],
          ['services', va.id],
        ]) {
          assert.equal((await request(`/${collection}`)).status, 401);
          for (const cookie of [agent, doctor]) {
            assert.equal((await request(`/${collection}`, cookie)).status, 403);
            assert.equal(
              (await request(`/${collection}/${id}`, cookie)).status,
              403,
            );
            assert.equal(
              (
                await request(`/${collection}`, cookie, 'POST', {
                  name: 'Negado',
                })
              ).status,
              403,
            );
            assert.equal(
              (
                await request(`/${collection}/${id}`, cookie, 'PATCH', {
                  active: false,
                })
              ).status,
              403,
            );
          }
          assert.equal(
            (
              await request(
                `/${collection}/${id}`,
                a,
                'PATCH',
                { active: false },
                { Origin: 'https://evil.test' },
              )
            ).status,
            403,
          );
        }
        await client.rolePermission.delete({
          where: {
            roleName_permissionName: {
              roleName: 'CLINIC_ADMIN',
              permissionName: 'service.manage',
            },
          },
        });
        try {
          assert.equal((await request('/services', a)).status, 403);
          assert.equal((await request('/specialties', a)).status, 403);
        } finally {
          await client.rolePermission.create({
            data: {
              roleName: 'CLINIC_ADMIN',
              permissionName: 'service.manage',
            },
          });
        }
      },
    );
    await t.test(
      'constraints PostgreSQL: tenant composto, unicidade e valores válidos',
      async () => {
        const base = {
          tenantId: aTenant.id,
          specialtyId: sa.id,
          name: 'Constraint',
          durationMinutes: 30,
        };
        for (const invalid of [
          { specialtyId: sb.id },
          { durationMinutes: 0 },
          { durationMinutes: -1 },
          { bufferBeforeMinutes: -1 },
          { bufferAfterMinutes: -1 },
          { price: '-0.01' },
          { price: 'NaN' },
        ])
          await assert.rejects(
            client.service.create({ data: { ...base, ...invalid } }),
          );
        await assert.rejects(
          client.specialty.create({
            data: { tenantId: aTenant.id, name: 'Dermatologia' },
          }),
        );
        await assert.rejects(
          client.service.create({
            data: { ...base, specialtyId: second.id, name: 'Retorno' },
          }),
        );
        await assert.rejects(
          client.specialty.delete({ where: { id: second.id } }),
        );
        const responses = await Promise.all(
          [1, 2].map(() =>
            request('/services', a, 'POST', {
              name: 'Concorrente',
              specialtyId: sa.id,
              durationMinutes: 30,
            }),
          ),
        );
        assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
        assert.equal(
          await client.service.count({
            where: { tenantId: aTenant.id, name: 'Concorrente' },
          }),
          1,
        );
      },
    );
    await t.test(
      'services/repositories revalidam contexto; revogação no SQL e auditoria atômica',
      async () => {
        const session = await client.authSession.findUniqueOrThrow({
          where: { tokenHash: tokenHash(a.split('=')[1]!) },
        });
        const database = { client } as DatabaseService;
        const auth = new AuthorizationService(
          database,
          new TenantContext(
            {
              identity: users[0],
              sessionId: session.id,
              activeTenantId: aTenant.id,
            } as AuthRequest,
            database,
          ),
        );
        const original = auth.requirePermissions.bind(auth);
        auth.requirePermissions = async (...permissions) => {
          const scope = await original(...permissions);
          await client.userTenant.update({
            where: {
              userId_tenantId: { userId: users[0]!.id, tenantId: aTenant.id },
            },
            data: { active: false },
          });
          return scope;
        };
        try {
          assert.deepEqual(
            await new SpecialtyRepository(database, auth).list({}),
            [],
          );
          // Permissão válida na captura; o wrapper a revoga antes da transação.
          await client.userTenant.update({
            where: {
              userId_tenantId: { userId: users[0]!.id, tenantId: aTenant.id },
            },
            data: { active: true },
          });
          await assert.rejects(
            new ServiceRepository(database, auth).update(va.id, {
              name: 'Negado',
            }),
            ForbiddenException,
          );
        } finally {
          await client.userTenant.update({
            where: {
              userId_tenantId: { userId: users[0]!.id, tenantId: aTenant.id },
            },
            data: { active: true },
          });
          auth.requirePermissions = original;
        }
        const failing = {
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
                              throw new Error('Auditoria indisponível');
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
          new ServiceRepository(failing, auth).update(va.id, { active: false }),
        );
        assert.equal(
          (await client.service.findUniqueOrThrow({ where: { id: va.id } }))
            .active,
          true,
        );
        await assert.rejects(
          new SpecialtyRepository(failing, auth).create({ name: 'Rollback' }),
        );
        assert.equal(
          await client.specialty.count({
            where: { tenantId: aTenant.id, name: 'Rollback' },
          }),
          0,
        );
        const empty = new AuthorizationService(
          database,
          new TenantContext({} as AuthRequest, database),
        );
        const specialtyRepository = new SpecialtyRepository(database, empty),
          serviceRepository = new ServiceRepository(database, empty);
        await assert.rejects(specialtyRepository.find(sa.id));
        await assert.rejects(serviceRepository.find(va.id));
        await assert.rejects(
          new SpecialtiesService(empty, specialtyRepository).create({
            name: 'Negado',
          }),
        );
        await assert.rejects(
          new ServicesService(empty, serviceRepository).create({
            name: 'Negado',
            specialtyId: sa.id,
            durationMinutes: 30,
          }),
        );
        const events = await client.authEvent.findMany({
          where: {
            tenantId: aTenant.id,
            type: {
              in: [
                'SPECIALTY_CREATED',
                'SPECIALTY_UPDATED',
                'SERVICE_CREATED',
                'SERVICE_UPDATED',
              ],
            },
          },
        });
        assert.ok(events.length > 10);
        assert.ok(
          events.every((x) => x.userId === users[0]!.id && x.resourceId),
        );
        const audit = JSON.stringify(events.map((x) => x.changes));
        assert.ok(
          !audit.includes('Atendimento concreto') &&
            !audit.includes('1234567890.12'),
        );
      },
    );
  } finally {
    await app.close();
    await client.$disconnect();
  }
});
