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
import { ProviderRepository } from '../src/providers/provider.repository';
import { ProviderServiceRepository } from '../src/providers/provider-service.repository';
import { ProviderUnitRepository } from '../src/providers/provider-unit.repository';
import { EligibleProvidersRepository } from '../src/providers/eligible-providers.repository';
import { ProvidersService } from '../src/providers/providers.service';
import { ProviderServicesService } from '../src/providers/provider-services.service';
import { ProviderUnitsService } from '../src/providers/provider-units.service';
const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).pathname !== '/task002_test' ||
  connection !== process.env.DATABASE_URL
)
  throw new Error('Use pnpm db:test.');
interface Provider {
  id: string;
  name: string;
  professionalType: string;
  registrationNumber?: string | null;
  active: boolean;
}
interface ServiceLink {
  id: string;
  providerId: string;
  serviceId: string;
  durationOverrideMinutes: number | null;
  priceOverride: string | null;
  active: boolean;
  service: {
    id: string;
    name: string;
    active: boolean;
    durationMinutes: number;
    price: string | null;
  };
}
interface UnitLink {
  id: string;
  providerId: string;
  unitId: string;
  active: boolean;
  unit: { id: string; name: string; active: boolean };
}

test('profissionais, serviços e unidades: N:N, overrides, RBAC e isolamento PostgreSQL', async (t) => {
  const client = createDatabaseClient(connection);
  const app = await createApplication();
  try {
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const ta = await client.tenant.create({
      data: { name: 'Profissionais A', status: 'ACTIVE', timezone: 'UTC' },
    });
    const tb = await client.tenant.create({
      data: { name: 'Profissionais B', status: 'ACTIVE', timezone: 'UTC' },
    });
    const specialtyA = await client.specialty.create({
      data: { tenantId: ta.id, name: 'Área A' },
    });
    const specialtyB = await client.specialty.create({
      data: { tenantId: tb.id, name: 'Área B' },
    });
    const s1 = await client.service.create({
      data: {
        tenantId: ta.id,
        specialtyId: specialtyA.id,
        name: 'Primeira consulta',
        durationMinutes: 60,
        price: '100.10',
      },
    });
    const s2 = await client.service.create({
      data: {
        tenantId: ta.id,
        specialtyId: specialtyA.id,
        name: 'Avaliação',
        durationMinutes: 30,
      },
    });
    const sb = await client.service.create({
      data: {
        tenantId: tb.id,
        specialtyId: specialtyB.id,
        name: 'Primeira consulta',
        durationMinutes: 60,
      },
    });
    const u1 = await client.unit.create({
      data: { tenantId: ta.id, name: 'Brasília', address: 'Rua A' },
    });
    const u2 = await client.unit.create({
      data: { tenantId: ta.id, name: 'Asa Norte', address: 'Rua B' },
    });
    const ub = await client.unit.create({
      data: { tenantId: tb.id, name: 'Outra clínica', address: 'Rua C' },
    });
    const password = 'senha longa profissional teste';
    const passwordHash = await hashPassword(password);
    const users: { id: string; email: string; name: string }[] = [];
    for (const [tenantId, role] of [
      [ta.id, 'CLINIC_ADMIN'],
      [tb.id, 'CLINIC_ADMIN'],
      [ta.id, 'AGENT'],
      [ta.id, 'DOCTOR'],
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
    const a = await login(0, ta.id),
      b = await login(1, tb.id),
      agent = await login(2, ta.id),
      doctor = await login(3, ta.id);
    const createProvider = async (name: string, cookie = a) => {
      const response = await request('/providers', cookie, 'POST', {
        name,
        professionalType: 'DENTIST',
        registrationNumber: 'CRO-DF/ABC-001',
      });
      assert.equal(response.status, 201, await response.clone().text());
      return (await response.json()) as Provider;
    };
    const linkService = async (
      providerId: string,
      serviceId: string,
      body: Record<string, unknown> = {},
      cookie = a,
    ) => {
      const response = await request(
        `/providers/${providerId}/services`,
        cookie,
        'POST',
        { serviceId, ...body },
      );
      assert.equal(response.status, 201, await response.clone().text());
      return (await response.json()) as ServiceLink;
    };
    const linkUnit = async (providerId: string, unitId: string, cookie = a) => {
      const response = await request(
        `/providers/${providerId}/units`,
        cookie,
        'POST',
        { unitId },
      );
      assert.equal(response.status, 201, await response.clone().text());
      return (await response.json()) as UnitLink;
    };
    const eligible = async (serviceId: string, cookie = a) => {
      const response = await request(
        `/services/${serviceId}/providers`,
        cookie,
      );
      assert.equal(response.status, 200);
      return (await response.json()) as Provider[];
    };
    let joao: Provider, ana: Provider, foreign: Provider;
    let j1: ServiceLink, j2: ServiceLink, a1: ServiceLink, b1: ServiceLink;
    let ju1: UnitLink, ju2: UnitLink, bu1: UnitLink;
    await t.test(
      'Provider textual e nomes/registros iguais entre tenants; N:N de serviços e respostas mínimas',
      async () => {
        joao = await createProvider('Dr. João');
        ana = await createProvider('Dra. Ana');
        foreign = await createProvider('Dr. João', b);
        assert.equal(foreign.registrationNumber, joao.registrationNumber);
        assert.deepEqual(Object.keys(joao).sort(), [
          'active',
          'id',
          'name',
          'professionalType',
          'registrationNumber',
        ]);
        j1 = await linkService(joao.id, s1.id);
        j2 = await linkService(joao.id, s2.id);
        a1 = await linkService(ana.id, s1.id, {
          durationOverrideMinutes: 45,
          priceOverride: '150.20',
        });
        b1 = await linkService(foreign.id, sb.id, {}, b);
        const links = (await (
          await request(`/providers/${joao.id}/services`, a)
        ).json()) as ServiceLink[];
        assert.deepEqual(
          links.map((x) => x.serviceId).sort(),
          [s1.id, s2.id].sort(),
        );
        assert.deepEqual(Object.keys(j1).sort(), [
          'active',
          'durationOverrideMinutes',
          'id',
          'priceOverride',
          'providerId',
          'service',
          'serviceId',
        ]);
        assert.deepEqual(Object.keys(j1.service).sort(), [
          'active',
          'durationMinutes',
          'id',
          'name',
          'price',
        ]);
        const apt = await eligible(s1.id);
        assert.deepEqual(apt.map((x) => x.id).sort(), [joao.id, ana.id].sort());
        assert.deepEqual(Object.keys(apt[0]!).sort(), [
          'active',
          'id',
          'name',
          'professionalType',
        ]);
        assert.deepEqual(
          (await eligible(sb.id, b)).map((x) => x.id),
          [foreign.id],
        );
      },
    );
    await t.test(
      'um Provider em várias Units; vínculos consultáveis sem dados internos',
      async () => {
        const count = await client.provider.count();
        ju1 = await linkUnit(joao.id, u1.id);
        ju2 = await linkUnit(joao.id, u2.id);
        bu1 = await linkUnit(foreign.id, ub.id, b);
        await linkUnit(ana.id, u1.id);
        const rows = (await (
          await request(`/providers/${joao.id}/units`, a)
        ).json()) as UnitLink[];
        assert.deepEqual(
          rows.map((x) => x.unitId).sort(),
          [u1.id, u2.id].sort(),
        );
        assert.equal(await client.provider.count(), count);
        assert.deepEqual(Object.keys(ju1).sort(), [
          'active',
          'id',
          'providerId',
          'unit',
          'unitId',
        ]);
        assert.deepEqual(Object.keys(ju1.unit).sort(), [
          'active',
          'id',
          'name',
        ]);
      },
    );
    await t.test(
      'overrides null não copiam Service; mudanças de defaults são refletidas sem persistir cópias',
      async () => {
        assert.equal(j1.durationOverrideMinutes, null);
        assert.equal(j1.priceOverride, null);
        assert.equal(j1.service.durationMinutes, 60);
        assert.equal(j1.service.price, '100.10');
        assert.equal(j2.service.price, null);
        await client.service.update({
          where: { id: s1.id },
          data: { durationMinutes: 75, price: '200.30' },
        });
        const links = (await (
          await request(`/providers/${joao.id}/services`, a)
        ).json()) as ServiceLink[];
        const link = links.find((x) => x.id === j1.id)!;
        assert.equal(link.durationOverrideMinutes, null);
        assert.equal(link.priceOverride, null);
        assert.equal(link.service.durationMinutes, 75);
        assert.equal(link.service.price, '200.30');
        const stored = await client.providerService.findUniqueOrThrow({
          where: { id: j1.id },
        });
        assert.equal(stored.durationOverrideMinutes, null);
        assert.equal(stored.priceOverride, null);
        const fixed = await client.providerService.findUniqueOrThrow({
          where: { id: a1.id },
        });
        assert.equal(fixed.durationOverrideMinutes, 45);
        assert.equal(fixed.priceOverride!.toFixed(2), '150.20');
      },
    );
    await t.test(
      'valida duração, preço e DTOs; relacionamentos/tenant não podem ser reatribuídos',
      async () => {
        for (const invalid of [
          { durationOverrideMinutes: 0 },
          { durationOverrideMinutes: -1 },
          { durationOverrideMinutes: 1.5 },
          { priceOverride: '-1.00' },
          { priceOverride: 1.1 },
          { priceOverride: '1.001' },
          { tenantId: tb.id },
        ]) {
          assert.equal(
            (
              await request(`/providers/${joao.id}/services`, a, 'POST', {
                serviceId: s1.id,
                ...invalid,
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await request(
                `/providers/${joao.id}/services/${j1.id}`,
                a,
                'PATCH',
                invalid,
              )
            ).status,
            400,
          );
        }
        assert.equal(
          (
            await request(
              `/providers/${joao.id}/services/${j1.id}`,
              a,
              'PATCH',
              { serviceId: s2.id },
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(`/providers/${joao.id}/units/${ju1.id}`, a, 'PATCH', {
              unitId: u2.id,
            })
          ).status,
          400,
        );
        for (const body of [
          {},
          { name: 'x' },
          { name: 'x', professionalType: 'DOCTOR', registrationNumber: 1 },
          { name: 'x', professionalType: 'DOCTOR', tenantId: tb.id },
        ])
          assert.equal(
            (await request('/providers', a, 'POST', body)).status,
            400,
          );
        assert.equal((await request('/providers/not-a-uuid', a)).status, 400);
        for (const query of [
          'active=maybe',
          'active=true&active=false',
          `tenantId=${tb.id}`,
        ])
          assert.equal((await request(`/providers?${query}`, a)).status, 400);
        assert.equal(
          (await request(`/providers/${joao.id}/units?active=1`, a)).status,
          400,
        );
      },
    );
    await t.test(
      'IDs conhecidos de outro tenant negam leitura, atualização, inativação e associação',
      async () => {
        for (const providerId of [foreign.id, randomUUID()]) {
          for (const suffix of ['', '/services', '/units']) {
            const response = await request(
              `/providers/${providerId}${suffix}`,
              a,
            );
            assert.equal(response.status, 404);
            assert.equal(
              ((await response.json()) as { message: string }).message,
              'Recurso não encontrado.',
            );
          }
          for (const payload of [{ name: 'Ataque' }, { active: false }])
            assert.equal(
              (await request(`/providers/${providerId}`, a, 'PATCH', payload))
                .status,
              404,
            );
          assert.equal(
            (
              await request(`/providers/${providerId}/services`, a, 'POST', {
                serviceId: s1.id,
              })
            ).status,
            404,
          );
          assert.equal(
            (
              await request(`/providers/${providerId}/units`, a, 'POST', {
                unitId: u1.id,
              })
            ).status,
            404,
          );
        }
        for (const serviceId of [sb.id, randomUUID()]) {
          assert.equal(
            (
              await request(`/providers/${joao.id}/services`, a, 'POST', {
                serviceId,
              })
            ).status,
            404,
          );
          assert.equal(
            (await request(`/services/${serviceId}/providers`, a)).status,
            404,
          );
        }
        for (const unitId of [ub.id, randomUUID()])
          assert.equal(
            (
              await request(`/providers/${joao.id}/units`, a, 'POST', {
                unitId,
              })
            ).status,
            404,
          );
        for (const [suffix, linkId] of [
          ['services', b1.id],
          ['units', bu1.id],
        ])
          assert.equal(
            (
              await request(
                `/providers/${joao.id}/${suffix}/${linkId}`,
                a,
                'PATCH',
                { active: false },
              )
            ).status,
            404,
          );
        assert.equal(
          (
            await request(
              `/providers/${joao.id}/services/${a1.id}`,
              a,
              'PATCH',
              { active: false },
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(`/providers/${foreign.id}`, a, 'GET', undefined, {
              'X-Tenant-ID': tb.id,
            })
          ).status,
          404,
        );
        assert.equal((await request(`/providers/${joao.id}`, b)).status, 404);
        assert.equal(
          (await request(`/providers/${foreign.id}`, b)).status,
          200,
        );
        const all = (await (
          await request('/providers', a)
        ).json()) as Provider[];
        assert.deepEqual(all.map((x) => x.id).sort(), [joao.id, ana.id].sort());
      },
    );
    await t.test(
      'duplicidade é rejeitada, inclusive após inativação; concorrência preserva um vínculo',
      async () => {
        for (const [suffix, key, id] of [
          ['services', 'serviceId', s1.id],
          ['units', 'unitId', u1.id],
        ])
          assert.equal(
            (
              await request(`/providers/${joao.id}/${suffix}`, a, 'POST', {
                [key!]: id,
              })
            ).status,
            409,
          );
        assert.equal(
          (
            await request(
              `/providers/${joao.id}/services/${j1.id}`,
              a,
              'PATCH',
              { active: false },
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await request(`/providers/${joao.id}/services`, a, 'POST', {
              serviceId: s1.id,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await request(
              `/providers/${joao.id}/services/${j1.id}`,
              a,
              'PATCH',
              { active: true },
            )
          ).status,
          200,
        );
        const results = await Promise.all(
          [1, 2].map(() =>
            request(`/providers/${ana.id}/services`, a, 'POST', {
              serviceId: s2.id,
            }),
          ),
        );
        assert.deepEqual(results.map((x) => x.status).sort(), [201, 409]);
        assert.equal(
          await client.providerService.count({
            where: { tenantId: ta.id, providerId: ana.id, serviceId: s2.id },
          }),
          1,
        );
      },
    );
    await t.test(
      'preço exato incluindo zero e limite; remoção de overrides volta a null',
      async () => {
        for (const [value, expected] of [
          ['0.1', '0.10'],
          ['0', '0.00'],
          ['9999999999.99', '9999999999.99'],
          ['1234567890.12', '1234567890.12'],
        ]) {
          const response = await request(
            `/providers/${joao.id}/services/${j1.id}`,
            a,
            'PATCH',
            { priceOverride: value, durationOverrideMinutes: 45 },
          );
          assert.equal(response.status, 200, await response.clone().text());
          assert.equal(
            ((await response.json()) as ServiceLink).priceOverride,
            expected,
          );
          assert.equal(
            (
              await client.providerService.findUniqueOrThrow({
                where: { id: j1.id },
              })
            ).priceOverride!.toFixed(2),
            expected,
          );
        }
        const clear = await request(
          `/providers/${joao.id}/services/${j1.id}`,
          a,
          'PATCH',
          { priceOverride: null, durationOverrideMinutes: null },
        );
        assert.equal(clear.status, 200);
        const row = (await clear.json()) as ServiceLink;
        assert.equal(row.priceOverride, null);
        assert.equal(row.durationOverrideMinutes, null);
      },
    );
    await t.test(
      'inativação preserva histórico; consulta de aptos respeita os três indicadores',
      async () => {
        const count = await client.providerService.count();
        assert.equal(
          (
            await request(`/providers/${joao.id}`, a, 'PATCH', {
              name: 'João atualizado',
              professionalType: 'FUTURE_TYPE',
              registrationNumber: null,
              active: false,
            })
          ).status,
          200,
        );
        assert.equal(
          (await eligible(s1.id)).some((x) => x.id === joao.id),
          false,
        );
        assert.equal(
          (
            await client.providerService.findUniqueOrThrow({
              where: { id: j1.id },
            })
          ).active,
          true,
        );
        assert.deepEqual(
          (
            (await (
              await request('/providers?active=false', a)
            ).json()) as Provider[]
          ).map((x) => x.id),
          [joao.id],
        );
        assert.equal((await request(`/providers/${joao.id}`, a)).status, 200);
        assert.equal(
          (await request(`/providers/${joao.id}`, a, 'PATCH', { active: true }))
            .status,
          200,
        );
        assert.equal(
          (
            await request(
              `/providers/${joao.id}/services/${j1.id}`,
              a,
              'PATCH',
              { active: false },
            )
          ).status,
          200,
        );
        assert.equal(
          (await eligible(s1.id)).some((x) => x.id === joao.id),
          false,
        );
        assert.deepEqual(
          (
            (await (
              await request(`/providers/${joao.id}/services?active=false`, a)
            ).json()) as ServiceLink[]
          ).map((x) => x.id),
          [j1.id],
        );
        assert.equal(
          (
            await request(
              `/providers/${joao.id}/services/${j1.id}`,
              a,
              'PATCH',
              { active: true },
            )
          ).status,
          200,
        );
        await client.service.update({
          where: { id: s1.id },
          data: { active: false },
        });
        assert.deepEqual(await eligible(s1.id), []);
        await client.service.update({
          where: { id: s1.id },
          data: { active: true },
        });
        assert.equal((await eligible(s1.id)).length, 2);
        assert.equal(await client.providerService.count(), count);
        assert.equal(
          (
            await request(`/providers/${joao.id}/units/${ju1.id}`, a, 'PATCH', {
              active: false,
            })
          ).status,
          200,
        );
        assert.deepEqual(
          (
            (await (
              await request(`/providers/${joao.id}/units?active=false`, a)
            ).json()) as UnitLink[]
          ).map((x) => x.id),
          [ju1.id],
        );
        assert.deepEqual(
          (
            (await (
              await request(`/providers/${joao.id}/units?active=true`, a)
            ).json()) as UnitLink[]
          ).map((x) => x.id),
          [ju2.id],
        );
        assert.equal(
          (
            await request(`/providers/${joao.id}/units/${ju1.id}`, a, 'PATCH', {
              active: true,
            })
          ).status,
          200,
        );
        assert.equal(
          await client.providerUnit.count({
            where: { tenantId: ta.id, providerId: joao.id },
          }),
          2,
        );
      },
    );
    await t.test(
      'RBAC backend protege todas as rotas e permissões cumulativas, sem novo login',
      async () => {
        const routes: [string, string, unknown?][] = [
          ['/providers', 'GET'],
          [`/providers/${joao.id}`, 'GET'],
          ['/providers', 'POST', { name: 'x', professionalType: 'OTHER' }],
          [`/providers/${joao.id}`, 'PATCH', { active: false }],
          [`/providers/${joao.id}/services`, 'GET'],
          [`/providers/${joao.id}/services`, 'POST', { serviceId: s1.id }],
          [
            `/providers/${joao.id}/services/${j1.id}`,
            'PATCH',
            { active: false },
          ],
          [`/providers/${joao.id}/units`, 'GET'],
          [`/providers/${joao.id}/units`, 'POST', { unitId: u1.id }],
          [`/providers/${joao.id}/units/${ju1.id}`, 'PATCH', { active: false }],
          [`/services/${s1.id}/providers`, 'GET'],
        ];
        for (const [path, method, body] of routes) {
          assert.equal((await request(path, '', method, body)).status, 401);
          for (const cookie of [agent, doctor])
            assert.equal(
              (await request(path, cookie, method, body)).status,
              403,
            );
        }
        assert.equal(
          (
            await request(
              `/providers/${joao.id}`,
              a,
              'PATCH',
              { active: false },
              { Origin: 'https://evil.test' },
            )
          ).status,
          403,
        );
        for (const [permissionName, path] of [
          ['provider.manage', '/providers'],
          ['service.manage', `/providers/${joao.id}/services`],
          ['unit.view', `/providers/${joao.id}/units`],
        ] as const) {
          await client.rolePermission.delete({
            where: {
              roleName_permissionName: {
                roleName: 'CLINIC_ADMIN',
                permissionName,
              },
            },
          });
          try {
            assert.equal((await request(path, a)).status, 403);
            if (permissionName !== 'provider.manage')
              assert.equal((await request('/providers', a)).status, 200);
          } finally {
            await client.rolePermission.create({
              data: { roleName: 'CLINIC_ADMIN', permissionName },
            });
          }
        }
      },
    );
    await t.test(
      'FKs compostas, overrides e unicidade também são obrigatórios no PostgreSQL',
      async () => {
        const base = { tenantId: ta.id, providerId: joao.id, serviceId: s1.id };
        for (const data of [
          { ...base, providerId: foreign.id },
          { ...base, serviceId: sb.id },
        ])
          await assert.rejects(client.providerService.create({ data }));
        const fresh = await createProvider('Sem vínculos');
        for (const data of [
          { durationOverrideMinutes: 0 },
          { durationOverrideMinutes: -1 },
          { priceOverride: '-0.01' },
          { priceOverride: 'NaN' },
        ])
          await assert.rejects(
            client.providerService.create({
              data: { ...base, providerId: fresh.id, ...data },
            }),
          );
        await assert.rejects(client.providerService.create({ data: base }));
        await assert.rejects(
          client.providerUnit.create({
            data: { tenantId: ta.id, providerId: foreign.id, unitId: u1.id },
          }),
        );
        await assert.rejects(
          client.providerUnit.create({
            data: { tenantId: ta.id, providerId: joao.id, unitId: ub.id },
          }),
        );
        await assert.rejects(
          client.providerUnit.create({
            data: { tenantId: ta.id, providerId: joao.id, unitId: u1.id },
          }),
        );
        await assert.rejects(
          client.provider.delete({ where: { id: joao.id } }),
        );
        await assert.rejects(client.service.delete({ where: { id: s1.id } }));
        await assert.rejects(client.unit.delete({ where: { id: u1.id } }));
      },
    );
    await t.test(
      'revalidação SQL, ausência de contexto e rollback de auditoria',
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
              activeTenantId: ta.id,
            } as AuthRequest,
            database,
          ),
        );
        const original = auth.requirePermissions.bind(auth);
        auth.requirePermissions = async (...permissions) => {
          const scope = await original(...permissions);
          await client.providerService.update({
            where: { id: j1.id },
            data: { active: false },
          });
          return scope;
        };
        assert.equal(
          (
            await new EligibleProvidersRepository(database, auth).list(s1.id)
          ).some((x) => x.id === joao.id),
          false,
        );
        auth.requirePermissions = original;
        await client.providerService.update({
          where: { id: j1.id },
          data: { active: true },
        });
        auth.requirePermissions = async (...permissions) => {
          const scope = await original(...permissions);
          await client.userTenant.update({
            where: {
              userId_tenantId: { userId: users[0]!.id, tenantId: ta.id },
            },
            data: { active: false },
          });
          return scope;
        };
        try {
          await assert.rejects(
            new ProviderUnitRepository(database, auth).update(joao.id, ju1.id, {
              active: false,
            }),
            ForbiddenException,
          );
        } finally {
          await client.userTenant.update({
            where: {
              userId_tenantId: { userId: users[0]!.id, tenantId: ta.id },
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
          new ProviderRepository(failing, auth).create({
            name: 'Rollback',
            professionalType: 'OTHER',
          }),
        );
        assert.equal(
          await client.provider.count({
            where: { tenantId: ta.id, name: 'Rollback' },
          }),
          0,
        );
        await assert.rejects(
          new ProviderServiceRepository(failing, auth).update(joao.id, j1.id, {
            active: false,
          }),
        );
        assert.equal(
          (
            await client.providerService.findUniqueOrThrow({
              where: { id: j1.id },
            })
          ).active,
          true,
        );
        await assert.rejects(
          new ProviderUnitRepository(failing, auth).update(joao.id, ju1.id, {
            active: false,
          }),
        );
        assert.equal(
          (
            await client.providerUnit.findUniqueOrThrow({
              where: { id: ju1.id },
            })
          ).active,
          true,
        );
        const empty = new AuthorizationService(
          database,
          new TenantContext({} as AuthRequest, database),
        );
        const p = new ProviderRepository(database, empty),
          ps = new ProviderServiceRepository(database, empty),
          pu = new ProviderUnitRepository(database, empty),
          ep = new EligibleProvidersRepository(database, empty);
        await assert.rejects(p.find(joao.id));
        await assert.rejects(ps.list(joao.id, {}));
        await assert.rejects(pu.list(joao.id, {}));
        await assert.rejects(ep.list(s1.id));
        await assert.rejects(
          new ProvidersService(empty, p).create({
            name: 'Negado',
            professionalType: 'OTHER',
          }),
        );
        await assert.rejects(
          new ProviderServicesService(empty, ps, ep).create(joao.id, {
            serviceId: s1.id,
          }),
        );
        await assert.rejects(
          new ProviderUnitsService(empty, pu).create(joao.id, {
            unitId: u1.id,
          }),
        );
        const events = await client.authEvent.findMany({
          where: {
            tenantId: ta.id,
            type: {
              in: [
                'PROVIDER_CREATED',
                'PROVIDER_UPDATED',
                'PROVIDER_SERVICE_CREATED',
                'PROVIDER_SERVICE_UPDATED',
                'PROVIDER_UNIT_CREATED',
                'PROVIDER_UNIT_UPDATED',
              ],
            },
          },
        });
        assert.ok(events.length > 15);
        assert.ok(
          events.every((x) => x.userId === users[0]!.id && x.resourceId),
        );
        const audit = JSON.stringify(events.map((x) => x.changes));
        for (const secret of [
          'CRO-DF/ABC-001',
          'João atualizado',
          '1234567890.12',
        ])
          assert.ok(!audit.includes(secret));
      },
    );
  } finally {
    await app.close();
    await client.$disconnect();
  }
});
