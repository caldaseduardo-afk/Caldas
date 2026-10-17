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
import { AvailabilityRuleRepository } from '../src/availability/availability-rule.repository';
import { ScheduleExceptionRepository } from '../src/availability/schedule-exception.repository';
import { AvailabilityRepository } from '../src/availability/availability.repository';
import { AvailabilityService } from '../src/availability/availability.service';
import { AvailabilityRulesService } from '../src/availability/availability-rules.service';
import { ScheduleExceptionsService } from '../src/availability/schedule-exceptions.service';
import { civilDate, localTime } from '../src/availability/availability.dto';
const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).pathname !== '/task002_test' ||
  connection !== process.env.DATABASE_URL
)
  throw new Error('Use pnpm db:test.');
interface Rule {
  id: string;
  providerId: string;
  unitId: string;
  weekday: string;
  startTime: string;
  endTime: string;
  validFrom: string;
  validUntil: string | null;
  active: boolean;
}
interface Exception {
  id: string;
  providerId: string;
  unitId: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  type: string;
  reason: string | null;
  active: boolean;
}
interface Result {
  date: string;
  timezone: string;
  windows: { start: string; end: string }[];
}

test('disponibilidade: recorrência, exceções, timezone, conflitos e isolamento real', async (t) => {
  const client = createDatabaseClient(connection);
  const app = await createApplication();
  try {
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const ta = await client.tenant.create({
      data: {
        name: 'Disponibilidade A',
        status: 'ACTIVE',
        timezone: 'America/Sao_Paulo',
      },
    });
    const tb = await client.tenant.create({
      data: { name: 'Disponibilidade B', status: 'ACTIVE', timezone: 'UTC' },
    });
    const pa = await client.provider.create({
      data: { tenantId: ta.id, name: 'João', professionalType: 'DENTIST' },
    });
    const pb = await client.provider.create({
      data: { tenantId: tb.id, name: 'João', professionalType: 'DENTIST' },
    });
    const ua = await client.unit.create({
      data: { tenantId: ta.id, name: 'Brasília', address: 'Rua A' },
    });
    const u2 = await client.unit.create({
      data: {
        tenantId: ta.id,
        name: 'Outra',
        address: 'Rua B',
        timezoneOverride: 'America/New_York',
      },
    });
    const ub = await client.unit.create({
      data: { tenantId: tb.id, name: 'Brasília', address: 'Rua C' },
    });
    const binding = await client.providerUnit.create({
      data: { tenantId: ta.id, providerId: pa.id, unitId: ua.id },
    });
    await client.providerUnit.create({
      data: { tenantId: tb.id, providerId: pb.id, unitId: ub.id },
    });
    const password = 'senha longa disponibilidade teste';
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
    const base = {
      providerId: pa.id,
      unitId: ua.id,
      weekday: 'MONDAY',
      startTime: '08:00',
      endTime: '12:00',
      validFrom: '2026-10-01',
      validUntil: '2026-10-31',
    };
    const exBase = {
      providerId: pa.id,
      unitId: ua.id,
      date: '2026-10-12',
      type: 'BLOCK',
    };
    const rule = async (extra: Record<string, unknown> = {}, cookie = a) => {
      const response = await request('/availability-rules', cookie, 'POST', {
        ...base,
        ...extra,
      });
      assert.equal(response.status, 201, await response.clone().text());
      return (await response.json()) as Rule;
    };
    const exception = async (
      extra: Record<string, unknown> = {},
      cookie = a,
    ) => {
      const response = await request('/schedule-exceptions', cookie, 'POST', {
        ...exBase,
        ...extra,
      });
      assert.equal(response.status, 201, await response.clone().text());
      return (await response.json()) as Exception;
    };
    const windows = async (
      date: string,
      unitId = ua.id,
      providerId = pa.id,
      cookie = a,
    ) => {
      const response = await request(
        `/providers/${providerId}/availability?${new URLSearchParams({ unitId, date })}`,
        cookie,
      );
      assert.equal(response.status, 200, await response.clone().text());
      return (await response.json()) as Result;
    };
    let morning: Rule,
      afternoon: Rule,
      foreignRule: Rule,
      block: Exception,
      foreignException: Exception;
    await t.test(
      'cria períodos semanais separados e equivalentes entre tenants; responses mínimas',
      async () => {
        morning = await rule();
        afternoon = await rule({ startTime: '14:00', endTime: '18:00' });
        foreignRule = await rule({ providerId: pb.id, unitId: ub.id }, b);
        assert.equal(morning.weekday, 'MONDAY');
        assert.equal(morning.startTime, '08:00');
        assert.deepEqual(Object.keys(morning).sort(), [
          'active',
          'endTime',
          'id',
          'providerId',
          'startTime',
          'unitId',
          'validFrom',
          'validUntil',
          'weekday',
        ]);
        assert.deepEqual((await windows('2026-10-05')).windows, [
          { start: '08:00', end: '12:00' },
          { start: '14:00', end: '18:00' },
        ]);
        assert.deepEqual((await windows('2026-10-06')).windows, []);
        const all = (await (
          await request(
            `/availability-rules?providerId=${pa.id}&unitId=${ua.id}`,
            a,
          )
        ).json()) as Rule[];
        assert.deepEqual(
          all.map((x) => x.id).sort(),
          [morning.id, afternoon.id].sort(),
        );
        assert.equal(
          (await request(`/availability-rules/${morning.id}`, a)).status,
          200,
        );
      },
    );
    await t.test(
      'validação de horário/validade e vínculo ProviderUnit obrigatório',
      async () => {
        for (const invalid of [
          { startTime: '12:00' },
          { startTime: '13:00' },
          { validUntil: '2026-09-30' },
          { weekday: 'INVALID' },
          { startTime: '08:00Z' },
          { tenantId: tb.id },
        ])
          assert.equal(
            (
              await request('/availability-rules', a, 'POST', {
                ...base,
                ...invalid,
              })
            ).status,
            400,
          );
        assert.equal(
          (
            await request(`/availability-rules/${morning.id}`, a, 'PATCH', {
              endTime: '07:00',
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request(`/availability-rules/${morning.id}`, a, 'PATCH', {
              validFrom: '2026-11-01',
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request(`/availability-rules/${morning.id}`, a, 'PATCH', {
              unitId: u2.id,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request('/availability-rules', a, 'POST', {
              ...base,
              unitId: u2.id,
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await request('/schedule-exceptions', a, 'POST', {
              ...exBase,
              unitId: u2.id,
            })
          ).status,
          404,
        );
        await client.providerUnit.update({
          where: { id: binding.id },
          data: { active: false },
        });
        assert.equal(
          (
            await request('/availability-rules', a, 'POST', {
              ...base,
              weekday: 'TUESDAY',
            })
          ).status,
          409,
        );
        assert.deepEqual((await windows('2026-10-05')).windows, []);
        assert.equal(
          (
            await request(`/availability-rules/${morning.id}`, a, 'PATCH', {
              active: false,
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await request(`/availability-rules/${morning.id}`, a, 'PATCH', {
              active: true,
            })
          ).status,
          409,
        );
        await client.providerUnit.update({
          where: { id: binding.id },
          data: { active: true },
        });
        assert.equal(
          (
            await request(`/availability-rules/${morning.id}`, a, 'PATCH', {
              active: true,
            })
          ).status,
          200,
        );
      },
    );
    await t.test(
      'sobreposição na criação, atualização e reativação; adjacência e validades disjuntas',
      async () => {
        assert.equal(
          (
            await request('/availability-rules', a, 'POST', {
              ...base,
              startTime: '10:00',
              endTime: '14:00',
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await request(`/availability-rules/${afternoon.id}`, a, 'PATCH', {
              startTime: '11:00',
            })
          ).status,
          409,
        );
        const inactive = await rule({ active: false });
        assert.equal(
          (
            await request(`/availability-rules/${inactive.id}`, a, 'PATCH', {
              active: true,
            })
          ).status,
          409,
        );
        await rule({
          startTime: '12:00',
          endTime: '14:00',
          validFrom: '2027-01-01',
          validUntil: null,
        });
        await rule({ validFrom: '2027-01-01', validUntil: '2027-01-31' });
        assert.equal(
          (
            await request('/availability-rules', a, 'POST', {
              ...base,
              validFrom: '2026-10-31',
              validUntil: '2026-11-30',
            })
          ).status,
          409,
        );
        const contiguous = await rule({ startTime: '12:00', endTime: '14:00' });
        assert.deepEqual((await windows('2026-10-05')).windows, [
          { start: '08:00', end: '18:00' },
        ]);
        assert.equal(
          (
            await request(`/availability-rules/${contiguous.id}`, a, 'PATCH', {
              active: false,
            })
          ).status,
          200,
        );
        const concurrent = await Promise.all(
          [1, 2].map(() =>
            request('/availability-rules', a, 'POST', {
              ...base,
              weekday: 'FRIDAY',
              startTime: '20:00',
              endTime: '21:00',
            }),
          ),
        );
        assert.deepEqual(concurrent.map((x) => x.status).sort(), [201, 409]);
      },
    );
    await t.test(
      'BLOCK parcial divide janelas; exceção inativa não participa',
      async () => {
        block = await exception({
          startTime: '10:00',
          endTime: '11:00',
          reason: 'MOTIVO PRIVADO',
        });
        foreignException = await exception(
          {
            providerId: pb.id,
            unitId: ub.id,
            startTime: '09:00',
            endTime: '11:00',
          },
          b,
        );
        assert.deepEqual(Object.keys(block).sort(), [
          'active',
          'date',
          'endTime',
          'id',
          'providerId',
          'reason',
          'startTime',
          'type',
          'unitId',
        ]);
        assert.deepEqual((await windows('2026-10-12')).windows, [
          { start: '08:00', end: '10:00' },
          { start: '11:00', end: '12:00' },
          { start: '14:00', end: '18:00' },
        ]);
        assert.equal(
          (
            await request(`/schedule-exceptions/${block.id}`, a, 'PATCH', {
              active: false,
            })
          ).status,
          200,
        );
        assert.equal((await windows('2026-10-12')).windows.length, 2);
        assert.equal(
          (
            await request(`/schedule-exceptions/${block.id}`, a, 'PATCH', {
              active: true,
            })
          ).status,
          200,
        );
        assert.equal(
          (await request(`/schedule-exceptions/${block.id}`, a)).status,
          200,
        );
        assert.equal(
          (
            await request(`/schedule-exceptions/${block.id}`, a, 'PATCH', {
              endTime: '09:00',
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request(`/schedule-exceptions/${block.id}`, a, 'PATCH', {
              startTime: null,
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      'férias/feriado de dia inteiro prevalecem sobre extras; extras unem janelas',
      async () => {
        await exception({ type: 'VACATION', date: '2026-10-19' });
        await exception({
          type: 'EXTRA_AVAILABILITY',
          date: '2026-10-19',
          startTime: '18:00',
          endTime: '20:00',
        });
        assert.deepEqual((await windows('2026-10-19')).windows, []);
        await exception({ type: 'HOLIDAY', date: '2026-10-26' });
        assert.deepEqual((await windows('2026-10-26')).windows, []);
        await exception({
          type: 'EXTRA_AVAILABILITY',
          date: '2026-10-17',
          startTime: '08:00',
          endTime: '10:00',
        });
        await exception({
          type: 'EXTRA_AVAILABILITY',
          date: '2026-10-17',
          startTime: '10:00',
          endTime: '12:00',
        });
        await exception({
          type: 'EXTRA_AVAILABILITY',
          date: '2026-10-17',
          startTime: '11:00',
          endTime: '13:00',
        });
        assert.deepEqual((await windows('2026-10-17')).windows, [
          { start: '08:00', end: '13:00' },
        ]);
        await exception({
          type: 'MEETING',
          date: '2026-10-17',
          startTime: '09:00',
          endTime: '11:00',
        });
        await exception({
          type: 'OTHER',
          date: '2026-10-17',
          startTime: '12:00',
          endTime: '13:00',
        });
        assert.deepEqual((await windows('2026-10-17')).windows, [
          { start: '08:00', end: '09:00' },
          { start: '11:00', end: '12:00' },
        ]);
        for (const invalid of [
          { startTime: '10:00' },
          { type: 'EXTRA_AVAILABILITY' },
          { startTime: '11:00', endTime: '10:00' },
        ])
          assert.equal(
            (
              await request('/schedule-exceptions', a, 'POST', {
                ...exBase,
                ...invalid,
              })
            ).status,
            400,
          );
      },
    );
    await t.test(
      'validades inclusivas, regras inativas e entidades inativas',
      async () => {
        await rule({
          weekday: 'TUESDAY',
          validFrom: '2026-10-06',
          validUntil: '2026-10-13',
        });
        for (const date of ['2026-10-06', '2026-10-13'])
          assert.deepEqual((await windows(date)).windows, [
            { start: '08:00', end: '12:00' },
          ]);
        for (const date of [
          '2026-09-29',
          '2026-10-20',
          '2026-09-28',
          '2026-11-02',
        ])
          assert.deepEqual((await windows(date)).windows, []);
        assert.equal(
          (
            await request(`/availability-rules/${afternoon.id}`, a, 'PATCH', {
              active: false,
            })
          ).status,
          200,
        );
        assert.deepEqual((await windows('2026-10-05')).windows, [
          { start: '08:00', end: '12:00' },
        ]);
        assert.equal(
          (
            await request(`/availability-rules/${afternoon.id}`, a, 'PATCH', {
              active: true,
            })
          ).status,
          200,
        );
        await client.provider.update({
          where: { id: pa.id },
          data: { active: false },
        });
        assert.deepEqual((await windows('2026-10-05')).windows, []);
        await client.provider.update({
          where: { id: pa.id },
          data: { active: true },
        });
        await client.unit.update({
          where: { id: ua.id },
          data: { active: false },
        });
        assert.deepEqual((await windows('2026-10-05')).windows, []);
        await client.unit.update({
          where: { id: ua.id },
          data: { active: true },
        });
        assert.ok(
          await client.availabilityRule.findUnique({
            where: { id: morning.id },
          }),
        );
      },
    );
    await t.test(
      'filtros por provider/unidade/data são inclusivos e isolados, sem campos arbitrários',
      async () => {
        const response = await request(
          `/schedule-exceptions?providerId=${pa.id}&unitId=${ua.id}&dateFrom=2026-10-12&dateUntil=2026-10-12&active=true`,
          a,
        );
        assert.equal(response.status, 200);
        assert.deepEqual(
          ((await response.json()) as Exception[]).map((x) => x.id),
          [block.id],
        );
        const own = (await (
          await request(
            '/schedule-exceptions?dateFrom=2026-10-01&dateUntil=2026-10-31',
            a,
          )
        ).json()) as Exception[];
        assert.ok(
          own.every((x) => x.providerId === pa.id && x.unitId === ua.id),
        );
        for (const collection of [
          'availability-rules',
          'schedule-exceptions',
        ]) {
          for (const query of [`providerId=${pb.id}`, `unitId=${ub.id}`])
            assert.equal(
              (await request(`/${collection}?${query}`, a)).status,
              404,
            );
          assert.equal(
            (await request(`/${collection}?tenantId=${tb.id}`, a)).status,
            400,
          );
          assert.equal(
            (await request(`/${collection}?active=true&active=false`, a))
              .status,
            400,
          );
        }
        assert.equal(
          (
            await request(
              '/schedule-exceptions?dateFrom=2026-10-20&dateUntil=2026-10-01',
              a,
            )
          ).status,
          400,
        );
      },
    );
    await t.test(
      'IDs conhecidos de outro tenant não autorizam leitura, escrita, cálculo ou associações',
      async () => {
        for (const [collection, id] of [
          ['availability-rules', foreignRule.id],
          ['schedule-exceptions', foreignException.id],
        ]) {
          const foreign = await request(`/${collection}/${id}`, a),
            absent = await request(`/${collection}/${randomUUID()}`, a);
          assert.equal(foreign.status, 404);
          assert.deepEqual(await foreign.json(), await absent.json());
          assert.equal(
            (
              await request(`/${collection}/${id}`, a, 'PATCH', {
                active: false,
              })
            ).status,
            404,
          );
        }
        for (const extra of [
          { providerId: pb.id },
          { unitId: ub.id },
          { providerId: pb.id, unitId: ub.id },
        ]) {
          assert.equal(
            (
              await request('/availability-rules', a, 'POST', {
                ...base,
                ...extra,
              })
            ).status,
            404,
          );
          assert.equal(
            (
              await request('/schedule-exceptions', a, 'POST', {
                ...exBase,
                ...extra,
              })
            ).status,
            404,
          );
        }
        assert.equal(
          (
            await request(
              `/providers/${pb.id}/availability?unitId=${ub.id}&date=2026-10-05`,
              a,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              `/providers/${pa.id}/availability?unitId=${ub.id}&date=2026-10-05`,
              a,
            )
          ).status,
          404,
        );
        assert.equal(
          (await request(`/availability-rules/${morning.id}`, b)).status,
          404,
        );
        assert.equal(
          (
            await request(
              `/availability-rules/${foreignRule.id}`,
              a,
              'GET',
              undefined,
              { 'X-Tenant-ID': tb.id },
            )
          ).status,
          404,
        );
      },
    );
    await t.test(
      'timezone herdado/override; datas DST são relógio civil, sem depender de timezone do cliente',
      async () => {
        const inherited = await windows('2026-10-05');
        assert.equal(inherited.timezone, 'America/Sao_Paulo');
        assert.equal(inherited.date, '2026-10-05');
        assert.deepEqual(Object.keys(inherited).sort(), [
          'date',
          'timezone',
          'windows',
        ]);
        await client.providerUnit.create({
          data: { tenantId: ta.id, providerId: pa.id, unitId: u2.id },
        });
        await rule({
          unitId: u2.id,
          weekday: 'SUNDAY',
          validFrom: '2026-03-01',
          validUntil: '2026-11-30',
          startTime: '01:30',
          endTime: '03:30',
        });
        for (const date of ['2026-03-08', '2026-11-01']) {
          const result = await windows(date, u2.id);
          assert.equal(result.timezone, 'America/New_York');
          assert.equal(result.date, date);
          assert.deepEqual(result.windows, [{ start: '01:30', end: '03:30' }]);
        }
        await client.tenant.update({
          where: { id: ta.id },
          data: { timezone: 'Pacific/Kiritimati' },
        });
        assert.equal(
          (await windows('2026-10-05')).timezone,
          'Pacific/Kiritimati',
        );
        assert.equal(
          (await windows('2026-03-08', u2.id)).timezone,
          'America/New_York',
        );
        assert.equal(
          (
            await request(
              `/providers/${pa.id}/availability?unitId=${ua.id}&date=2026-10-05T00:00:00Z`,
              a,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              `/providers/${pa.id}/availability?unitId=${ua.id}&date=2026-10-05&timezone=UTC`,
              a,
            )
          ).status,
          400,
        );
      },
    );
    await t.test(
      'RBAC, CSRF e revogação de permissão protegem gerenciamento e cálculo',
      async () => {
        const routes: [string, string, unknown?][] = [
          ['/availability-rules', 'GET'],
          [`/availability-rules/${morning.id}`, 'GET'],
          ['/availability-rules', 'POST', base],
          [`/availability-rules/${morning.id}`, 'PATCH', { active: false }],
          ['/schedule-exceptions', 'GET'],
          [`/schedule-exceptions/${block.id}`, 'GET'],
          ['/schedule-exceptions', 'POST', exBase],
          [`/schedule-exceptions/${block.id}`, 'PATCH', { active: false }],
          [
            `/providers/${pa.id}/availability?unitId=${ua.id}&date=2026-10-05`,
            'GET',
          ],
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
              `/availability-rules/${morning.id}`,
              a,
              'PATCH',
              { active: false },
              { Origin: 'https://evil.test' },
            )
          ).status,
          403,
        );
        await client.rolePermission.delete({
          where: {
            roleName_permissionName: {
              roleName: 'CLINIC_ADMIN',
              permissionName: 'unit.view',
            },
          },
        });
        try {
          assert.equal((await request('/availability-rules', a)).status, 403);
        } finally {
          await client.rolePermission.create({
            data: { roleName: 'CLINIC_ADMIN', permissionName: 'unit.view' },
          });
        }
      },
    );
    await t.test(
      'FK, CHECK e EXCLUDE protegem escrita direta e preservam histórico',
      async () => {
        const data = {
          tenantId: ta.id,
          providerId: pa.id,
          unitId: ua.id,
          weekday: 'MONDAY' as const,
          startTime: localTime('09:00'),
          endTime: localTime('11:00'),
          validFrom: civilDate('2026-10-01'),
          validUntil: civilDate('2026-10-31'),
        };
        await assert.rejects(client.availabilityRule.create({ data }));
        await assert.rejects(
          client.availabilityRule.create({
            data: { ...data, active: false, providerId: pb.id },
          }),
        );
        await assert.rejects(
          client.availabilityRule.create({
            data: { ...data, active: false, unitId: ub.id },
          }),
        );
        await assert.rejects(
          client.availabilityRule.create({
            data: { ...data, active: false, endTime: localTime('08:00') },
          }),
        );
        await assert.rejects(
          client.availabilityRule.create({
            data: {
              ...data,
              active: false,
              validUntil: civilDate('2026-09-30'),
            },
          }),
        );
        const detached = await client.unit.create({
          data: { tenantId: ta.id, name: 'Sem vínculo', address: 'Rua D' },
        });
        await assert.rejects(
          client.availabilityRule.create({
            data: { ...data, active: false, unitId: detached.id },
          }),
        );
        const exceptionData = {
          tenantId: ta.id,
          providerId: pa.id,
          unitId: ua.id,
          date: civilDate('2026-10-01'),
          type: 'BLOCK' as const,
        };
        await assert.rejects(
          client.scheduleException.create({
            data: { ...exceptionData, startTime: localTime('08:00') },
          }),
        );
        await assert.rejects(
          client.scheduleException.create({
            data: { ...exceptionData, type: 'EXTRA_AVAILABILITY' },
          }),
        );
        await assert.rejects(
          client.scheduleException.create({
            data: { ...exceptionData, unitId: ub.id },
          }),
        );
        await assert.rejects(
          client.providerUnit.delete({ where: { id: binding.id } }),
        );
      },
    );
    await t.test(
      'revalidação de contexto e rollback de auditoria também nos repositories',
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
          await client.providerUnit.update({
            where: { id: binding.id },
            data: { active: false },
          });
          return scope;
        };
        assert.deepEqual(
          (
            await new AvailabilityService(
              auth,
              new AvailabilityRepository(database, auth),
            ).getProviderAvailability(pa.id, ua.id, '2026-10-05')
          ).windows,
          [],
        );
        auth.requirePermissions = original;
        await client.providerUnit.update({
          where: { id: binding.id },
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
            new AvailabilityRuleRepository(database, auth).update(morning.id, {
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
          new AvailabilityRuleRepository(failing, auth).update(morning.id, {
            active: false,
          }),
        );
        assert.equal(
          (
            await client.availabilityRule.findUniqueOrThrow({
              where: { id: morning.id },
            })
          ).active,
          true,
        );
        await assert.rejects(
          new ScheduleExceptionRepository(failing, auth).update(block.id, {
            active: false,
          }),
        );
        assert.equal(
          (
            await client.scheduleException.findUniqueOrThrow({
              where: { id: block.id },
            })
          ).active,
          true,
        );
        const empty = new AuthorizationService(
          database,
          new TenantContext({} as AuthRequest, database),
        );
        const rules = new AvailabilityRuleRepository(database, empty),
          exceptions = new ScheduleExceptionRepository(database, empty),
          structural = new AvailabilityRepository(database, empty);
        await assert.rejects(rules.find(morning.id));
        await assert.rejects(exceptions.find(block.id));
        await assert.rejects(
          structural.load(pa.id, ua.id, civilDate('2026-10-05')),
        );
        await assert.rejects(
          new AvailabilityRulesService(empty, rules).create(base),
        );
        await assert.rejects(
          new ScheduleExceptionsService(empty, exceptions).create(exBase),
        );
        const events = await client.authEvent.findMany({
          where: {
            tenantId: ta.id,
            type: {
              in: [
                'AVAILABILITY_RULE_CREATED',
                'AVAILABILITY_RULE_UPDATED',
                'SCHEDULE_EXCEPTION_CREATED',
                'SCHEDULE_EXCEPTION_UPDATED',
              ],
            },
          },
        });
        assert.ok(events.length > 15);
        assert.ok(
          events.every((x) => x.userId === users[0]!.id && x.resourceId),
        );
        assert.ok(
          !JSON.stringify(events.map((x) => x.changes)).includes(
            'MOTIVO PRIVADO',
          ),
        );
      },
    );
  } finally {
    await app.close();
    await client.$disconnect();
  }
});
