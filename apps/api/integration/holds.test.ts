import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import {
  createDatabaseClient,
  sweepExpiredHolds,
  type Prisma,
} from '@atendente/database';
import { createApplication } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { tokenHash } from '../src/auth/auth.service';
import type { AuthRequest } from '../src/auth/auth.guard';
import type { DatabaseService } from '../src/auth/database.service';
import { TenantContext } from '../src/tenancy/tenant.context';
import { AuthorizationService } from '../src/permissions/authorization.service';
import {
  weekdays,
  civilDate,
  localTime,
} from '../src/availability/availability.dto';
import { HoldRepository } from '../src/holds/hold.repository';
import { HoldConfig } from '../src/holds/hold.config';
import { HoldsService } from '../src/holds/holds.service';
import { createHoldDto } from '../src/holds/hold.dto';
const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).pathname !== '/task002_test' ||
  connection !== process.env.DATABASE_URL
)
  throw new Error('Use pnpm db:test.');
interface Hold {
  id: string;
  patientId: string;
  contactId: string | null;
  providerId: string;
  serviceId: string;
  unitId: string;
  startAt: string;
  endAt: string;
  expiresAt: string;
  status: string;
}

test('HOLD PostgreSQL: duração, buffers, expiração, idempotência e duas instâncias concorrentes', async (t) => {
  const client = createDatabaseClient(connection);
  const app = await createApplication();
  const app2 = await createApplication();
  try {
    await app.listen(0, '127.0.0.1');
    await app2.listen(0, '127.0.0.1');
    const url = await app.getUrl(),
      url2 = await app2.getUrl();
    const ta = await client.tenant.create({
      data: { name: 'HOLD A', status: 'ACTIVE', timezone: 'America/Sao_Paulo' },
    });
    const tb = await client.tenant.create({
      data: { name: 'HOLD B', status: 'ACTIVE', timezone: 'UTC' },
    });
    const pa = await client.patient.create({
      data: {
        tenantId: ta.id,
        name: 'Paciente A',
        birthDate: civilDate('2000-01-01'),
      },
    });
    const pb = await client.patient.create({
      data: {
        tenantId: tb.id,
        name: 'Paciente B',
        birthDate: civilDate('2000-01-01'),
      },
    });
    const ca = await client.contact.create({
      data: { tenantId: ta.id, displayName: 'Contato A' },
    });
    const cb = await client.contact.create({
      data: { tenantId: tb.id, displayName: 'Contato B' },
    });
    const pra = await client.provider.create({
      data: {
        tenantId: ta.id,
        name: 'Profissional A',
        professionalType: 'DOCTOR',
      },
    });
    const prb = await client.provider.create({
      data: {
        tenantId: tb.id,
        name: 'Profissional B',
        professionalType: 'DOCTOR',
      },
    });
    const ua = await client.unit.create({
      data: { tenantId: ta.id, name: 'Unidade A', address: 'Rua A' },
    });
    const ub = await client.unit.create({
      data: { tenantId: tb.id, name: 'Unidade B', address: 'Rua B' },
    });
    const uMissing = await client.unit.create({
      data: { tenantId: ta.id, name: 'Sem vínculo', address: 'Rua C' },
    });
    const sa = await client.specialty.create({
      data: { tenantId: ta.id, name: 'Área' },
    });
    const sb = await client.specialty.create({
      data: { tenantId: tb.id, name: 'Área' },
    });
    const service = await client.service.create({
      data: {
        tenantId: ta.id,
        specialtyId: sa.id,
        name: 'Consulta',
        durationMinutes: 40,
      },
    });
    const foreignService = await client.service.create({
      data: {
        tenantId: tb.id,
        specialtyId: sb.id,
        name: 'Consulta',
        durationMinutes: 40,
      },
    });
    const noSkill = await client.service.create({
      data: {
        tenantId: ta.id,
        specialtyId: sa.id,
        name: 'Não habilitado',
        durationMinutes: 30,
      },
    });
    const ps = await client.providerService.create({
      data: { tenantId: ta.id, providerId: pra.id, serviceId: service.id },
    });
    await client.providerService.create({
      data: {
        tenantId: tb.id,
        providerId: prb.id,
        serviceId: foreignService.id,
      },
    });
    const pu = await client.providerUnit.create({
      data: { tenantId: ta.id, providerId: pra.id, unitId: ua.id },
    });
    await client.providerUnit.create({
      data: { tenantId: tb.id, providerId: prb.id, unitId: ub.id },
    });
    for (const [tenantId, providerId, unitId] of [
      [ta.id, pra.id, ua.id],
      [tb.id, prb.id, ub.id],
    ] as const)
      for (const weekday of weekdays)
        await client.availabilityRule.create({
          data: {
            tenantId,
            providerId,
            unitId,
            weekday,
            startTime: localTime('07:00'),
            endTime: localTime('20:00'),
            validFrom: civilDate('2035-01-01'),
            validUntil: civilDate('2035-12-31'),
          },
        });
    const password = 'senha longa hold teste';
    const passwordHash = await hashPassword(password);
    const users: { id: string; email: string; name: string }[] = [];
    for (const [tenantId, role] of [
      [ta.id, 'AGENT'],
      [tb.id, 'CLINIC_ADMIN'],
      [ta.id, 'DOCTOR'],
      [ta.id, 'CLINIC_ADMIN'],
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
    await client.contactPatient.create({
      data: {
        tenantId: ta.id,
        contactId: ca.id,
        patientId: pa.id,
        relationshipType: 'MOTHER',
        relationshipStatus: 'VERIFIED',
        authorizationLevel: 'SCHEDULING_ONLY',
        authorizedBy: users[3]!.id,
        authorizedAt: new Date(),
      },
    });
    const request = (
      path: string,
      cookie = '',
      method = 'GET',
      body?: unknown,
      server = url,
      extra: Record<string, string> = {},
    ) =>
      fetch(`${server}${path}`, {
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
      doctor = await login(2, ta.id),
      admin = await login(3, ta.id);
    const at = (day: number, time = '14:00') =>
      `2035-01-${String(day).padStart(2, '0')}T${time}:00-03:00`;
    const payload = (
      day: number,
      time = '14:00',
      extra: Record<string, unknown> = {},
    ) => ({
      requestId: randomUUID(),
      patientId: pa.id,
      serviceId: service.id,
      providerId: pra.id,
      unitId: ua.id,
      startAt: at(day, time),
      ...extra,
    });
    const create = async (data: unknown, cookie = a) => {
      const response = await request(
        '/appointment-holds',
        cookie,
        'POST',
        data,
      );
      assert.equal(response.status, 201, await response.clone().text());
      return (await response.json()) as Hold;
    };
    const active = async (day: number, cookie = a) =>
      request(
        `/appointment-holds/active?${new URLSearchParams({ providerId: pra.id, unitId: ua.id, startAt: at(day, '07:00'), endAt: at(day, '20:00') })}`,
        cookie,
      );
    const expire = (id: string) =>
      client.appointmentHold.update({
        where: { id },
        data: {
          createdAt: new Date(Date.now() - 120000),
          expiresAt: new Date(Date.now() - 60000),
        },
      });
    let first: Hold, foreign: Hold;
    await t.test(
      'criação pelo AGENT, UTC/duração padrão, contato autorizado e projeção mínima',
      async () => {
        first = await create(payload(1, '14:00', { contactId: ca.id }));
        foreign = await create(
          payload(1, '14:00', {
            patientId: pb.id,
            serviceId: foreignService.id,
            providerId: prb.id,
            unitId: ub.id,
          }),
          b,
        );
        assert.equal(first.startAt, '2035-01-01T17:00:00.000Z');
        assert.equal(first.endAt, '2035-01-01T17:40:00.000Z');
        assert.equal(first.status, 'ACTIVE');
        assert.ok(Date.parse(first.expiresAt) > Date.now());
        assert.deepEqual(Object.keys(first).sort(), [
          'contactId',
          'endAt',
          'expiresAt',
          'id',
          'patientId',
          'providerId',
          'serviceId',
          'startAt',
          'status',
          'unitId',
        ]);
        const list = await active(1);
        assert.equal(list.status, 200);
        const rows = (await list.json()) as Hold[];
        assert.equal(rows.length, 1);
        assert.deepEqual(Object.keys(rows[0]!).sort(), [
          'endAt',
          'expiresAt',
          'id',
          'startAt',
        ]);
        assert.equal(
          (await request(`/appointment-holds/${first.id}`, a)).status,
          200,
        );
      },
    );
    await t.test(
      'isolamento de entidades, vínculos obrigatórios e contato sem autorização',
      async () => {
        for (const invalid of [
          { patientId: pb.id },
          { serviceId: foreignService.id },
          { providerId: prb.id },
          { unitId: ub.id },
          { contactId: cb.id },
          { serviceId: noSkill.id },
          { unitId: uMissing.id },
        ])
          assert.equal(
            (
              await request(
                '/appointment-holds',
                a,
                'POST',
                payload(2, '14:00', invalid),
              )
            ).status,
            404,
          );
        await client.contactPatient.update({
          where: {
            tenantId_contactId_patientId: {
              tenantId: ta.id,
              contactId: ca.id,
              patientId: pa.id,
            },
          },
          data: { authorizationLevel: 'NO_ACCESS' },
        });
        assert.equal(
          (
            await request(
              '/appointment-holds',
              a,
              'POST',
              payload(2, '14:00', { contactId: ca.id }),
            )
          ).status,
          404,
        );
        await client.contactPatient.update({
          where: {
            tenantId_contactId_patientId: {
              tenantId: ta.id,
              contactId: ca.id,
              patientId: pa.id,
            },
          },
          data: { authorizationLevel: 'SCHEDULING_ONLY' },
        });
        for (const path of [
          `/appointment-holds/${foreign.id}`,
          `/appointment-holds/${randomUUID()}`,
        ]) {
          const response = await request(path, a);
          assert.equal(response.status, 404);
          assert.equal(
            ((await response.json()) as { message: string }).message,
            'Recurso não encontrado.',
          );
        }
        assert.equal(
          (await request(`/appointment-holds/${foreign.id}/release`, a, 'POST'))
            .status,
          404,
        );
        assert.equal(
          (await request(`/appointment-holds/${first.id}`, b)).status,
          404,
        );
        assert.equal((await active(1, b)).status, 404);
      },
    );
    await t.test(
      'duração calculada, start/end inválidos, período indisponível e override',
      async () => {
        for (const endAt of [at(2, '14:00'), at(2, '13:00'), at(2, '14:30')])
          assert.equal(
            (
              await request(
                '/appointment-holds',
                a,
                'POST',
                payload(2, '14:00', { endAt }),
              )
            ).status,
            400,
          );
        assert.equal(
          (await request('/appointment-holds', a, 'POST', payload(2, '06:00')))
            .status,
          409,
        );
        await client.providerService.update({
          where: { id: ps.id },
          data: { durationOverrideMinutes: 45 },
        });
        const hold = await create(payload(2));
        assert.equal(hold.endAt, '2035-01-02T17:45:00.000Z');
        await client.providerService.update({
          where: { id: ps.id },
          data: { durationOverrideMinutes: null },
        });
        for (const data of [
          { status: 'ACTIVE' },
          { tenantId: tb.id },
          { expiresAt: at(2) },
        ])
          assert.equal(
            (
              await request(
                '/appointment-holds',
                a,
                'POST',
                payload(3, '14:00', data),
              )
            ).status,
            400,
          );
        assert.equal(
          (
            await request(
              '/appointment-holds',
              a,
              'POST',
              payload(3, '14:00', { startAt: '2020-01-01T14:00:00Z' }),
            )
          ).status,
          400,
        );
      },
    );
    await t.test(
      'BLOCK impede HOLD; EXTRA válido cria janela sem recorrência',
      async () => {
        await client.scheduleException.create({
          data: {
            tenantId: ta.id,
            providerId: pra.id,
            unitId: ua.id,
            date: civilDate('2035-01-03'),
            startTime: localTime('14:10'),
            endTime: localTime('14:20'),
            type: 'BLOCK',
          },
        });
        assert.equal(
          (await request('/appointment-holds', a, 'POST', payload(3))).status,
          409,
        );
        await client.scheduleException.create({
          data: {
            tenantId: ta.id,
            providerId: pra.id,
            unitId: ua.id,
            date: civilDate('2035-01-03'),
            startTime: localTime('21:00'),
            endTime: localTime('22:00'),
            type: 'EXTRA_AVAILABILITY',
          },
        });
        const extra = await create(payload(3, '21:00'));
        assert.equal(extra.status, 'ACTIVE');
      },
    );
    await t.test(
      'duas instâncias: mesma faixa e sobreposição parcial têm só um sucesso',
      async () => {
        for (const [day, times] of [
          [4, ['14:00', '14:00']],
          [5, ['14:00', '14:20']],
        ] as const) {
          const results = await Promise.all([
            request(
              '/appointment-holds',
              a,
              'POST',
              payload(day, times[0]),
              url,
            ),
            request(
              '/appointment-holds',
              a,
              'POST',
              payload(day, times[1]),
              url2,
            ),
          ]);
          assert.deepEqual(results.map((x) => x.status).sort(), [201, 409]);
          assert.equal(
            ((await (await active(day)).json()) as Hold[]).length,
            1,
          );
        }
        const sequential = await create(payload(6));
        assert.equal(sequential.status, 'ACTIVE');
        assert.equal(
          (await request('/appointment-holds', a, 'POST', payload(6, '14:20')))
            .status,
          409,
        );
        const next = await create(payload(6, '14:40'));
        assert.equal(next.status, 'ACTIVE');
      },
    );
    await t.test(
      'buffers antes/depois ocupam tempo; editar Service não muda ocupação antiga',
      async () => {
        await client.service.update({
          where: { id: service.id },
          data: { bufferAfterMinutes: 10 },
        });
        const buffered = await create(payload(7));
        assert.equal(buffered.endAt, '2035-01-07T17:40:00.000Z');
        await client.service.update({
          where: { id: service.id },
          data: { bufferAfterMinutes: 0 },
        });
        assert.equal(
          (await request('/appointment-holds', a, 'POST', payload(7, '14:40')))
            .status,
          409,
        );
        await create(payload(7, '14:50'));
        await create(payload(8));
        await client.service.update({
          where: { id: service.id },
          data: { bufferBeforeMinutes: 10 },
        });
        assert.equal(
          (await request('/appointment-holds', a, 'POST', payload(8, '14:40')))
            .status,
          409,
        );
        await create(payload(8, '14:50'));
        assert.equal(
          (await request('/appointment-holds', a, 'POST', payload(9, '07:00')))
            .status,
          409,
        );
        await client.service.update({
          where: { id: service.id },
          data: { bufferBeforeMinutes: 0 },
        });
      },
    );
    await t.test(
      'idempotência concorrente e retry não estendem TTL nem reutilizam estados terminais',
      async () => {
        const data = payload(9);
        const responses = await Promise.all([
          request('/appointment-holds', a, 'POST', data),
          request('/appointment-holds', a, 'POST', data, url2),
        ]);
        assert.ok(responses.every((x) => x.status === 201));
        const [one, two] = await Promise.all(
          responses.map((x) => x.json() as Promise<Hold>),
        );
        assert.equal(one!.id, two!.id);
        assert.equal(one!.expiresAt, two!.expiresAt);
        assert.equal(
          (
            await request('/appointment-holds', a, 'POST', {
              ...data,
              startAt: at(9, '15:00'),
            })
          ).status,
          409,
        );
        assert.equal(
          (await request('/appointment-holds', admin, 'POST', data)).status,
          409,
        );
        assert.equal(
          (await request(`/appointment-holds/${one!.id}/release`, a, 'POST'))
            .status,
          200,
        );
        const retry = await create(data);
        assert.equal(retry.id, one!.id);
        assert.equal(retry.status, 'RELEASED');
        assert.equal(
          await client.authEvent.count({
            where: { resourceId: one!.id, type: 'HOLD_CREATED' },
          }),
          1,
        );
      },
    );
    await t.test(
      'vencido não bloqueia sem worker; EXPIRED e RELEASED liberam e histórico permanece',
      async () => {
        const stale = await create(payload(10));
        await expire(stale.id);
        assert.equal(
          (
            (await (
              await request(`/appointment-holds/${stale.id}`, a)
            ).json()) as Hold
          ).status,
          'EXPIRED',
        );
        assert.deepEqual(await (await active(10)).json(), []);
        const replacement = await create(payload(10));
        assert.notEqual(stale.id, replacement.id);
        assert.equal(
          (
            await client.appointmentHold.findUniqueOrThrow({
              where: { id: stale.id },
            })
          ).status,
          'EXPIRED',
        );
        for (let i = 0; i < 2; i++) {
          const response = await request(
            `/appointment-holds/${replacement.id}/release`,
            a,
            'POST',
          );
          assert.equal(response.status, 200);
          assert.equal(((await response.json()) as Hold).status, 'RELEASED');
        }
        assert.equal(
          await client.authEvent.count({
            where: { resourceId: replacement.id, type: 'HOLD_RELEASED' },
          }),
          1,
        );
        await create(payload(10));
        const expiredRelease = await create(payload(11));
        await expire(expiredRelease.id);
        assert.equal(
          (
            (await (
              await request(
                `/appointment-holds/${expiredRelease.id}/release`,
                a,
                'POST',
              )
            ).json()) as Hold
          ).status,
          'EXPIRED',
        );
        await create(payload(11));
      },
    );
    await t.test(
      'sweep real é idempotente entre workers e estados terminais não voltam a ACTIVE',
      async () => {
        const expired = await create(payload(12));
        await expire(expired.id);
        await Promise.all([
          sweepExpiredHolds(client),
          sweepExpiredHolds(client),
        ]);
        assert.equal(
          (
            await client.appointmentHold.findUniqueOrThrow({
              where: { id: expired.id },
            })
          ).status,
          'EXPIRED',
        );
        assert.equal(
          await client.authEvent.count({
            where: { resourceId: expired.id, type: 'HOLD_EXPIRED' },
          }),
          1,
        );
        await assert.rejects(
          client.appointmentHold.update({
            where: { id: expired.id },
            data: { status: 'ACTIVE' },
          }),
        );
        const consumed = await create(payload(13));
        await client.appointmentHold.update({
          where: { id: consumed.id },
          data: { status: 'CONSUMED' },
        });
        assert.equal(
          (
            await request(
              `/appointment-holds/${consumed.id}/release`,
              a,
              'POST',
            )
          ).status,
          409,
        );
        await assert.rejects(
          client.appointmentHold.update({
            where: { id: consumed.id },
            data: { status: 'ACTIVE' },
          }),
        );
      },
    );
    await t.test(
      'RBAC, sessão, CSRF e inativação dos relacionamentos',
      async () => {
        assert.equal(
          (await request('/appointment-holds', '', 'POST', payload(14))).status,
          401,
        );
        assert.equal(
          (await request('/appointment-holds', doctor, 'POST', payload(14)))
            .status,
          403,
        );
        assert.equal(
          (
            await request(
              `/appointment-holds/${first.id}/release`,
              doctor,
              'POST',
            )
          ).status,
          403,
        );
        assert.equal(
          (await request(`/appointment-holds/${first.id}`, doctor)).status,
          200,
        );
        assert.equal(
          (
            await request('/appointment-holds', a, 'POST', payload(14), url, {
              Origin: 'https://evil.test',
            })
          ).status,
          403,
        );
        await client.providerUnit.update({
          where: { id: pu.id },
          data: { active: false },
        });
        assert.equal(
          (await request('/appointment-holds', a, 'POST', payload(14))).status,
          409,
        );
        await client.providerUnit.update({
          where: { id: pu.id },
          data: { active: true },
        });
        await client.providerService.update({
          where: { id: ps.id },
          data: { active: false },
        });
        assert.equal(
          (await request('/appointment-holds', a, 'POST', payload(14))).status,
          404,
        );
        await client.providerService.update({
          where: { id: ps.id },
          data: { active: true },
        });
      },
    );
    await t.test(
      'constraints PostgreSQL protegem tenant, duração, TTL e sobreposição fora da API',
      async () => {
        const source = await client.appointmentHold.findUniqueOrThrow({
          where: { id: first.id },
        });
        const { id: _id, ...base } = source;
        void _id;
        for (const patch of [
          { patientId: pb.id },
          { serviceId: foreignService.id },
          { providerId: prb.id },
          { unitId: ub.id },
          { contactId: cb.id },
          { endAt: source.startAt },
          { expiresAt: source.createdAt },
        ])
          await assert.rejects(
            client.appointmentHold.create({
              data: { ...base, requestId: randomUUID(), ...patch },
            }),
          );
        await assert.rejects(
          client.appointmentHold.create({
            data: { ...base, requestId: randomUUID() },
          }),
        );
        const raw = {
          ...base,
          startAt: new Date(at(15)),
          endAt: new Date(at(15, '14:40')),
          occupiedStartAt: new Date(at(15)),
          occupiedEndAt: new Date(at(15, '14:40')),
        };
        const outcomes = await Promise.allSettled([
          client.appointmentHold.create({
            data: { ...raw, requestId: randomUUID() },
          }),
          client.appointmentHold.create({
            data: { ...raw, requestId: randomUUID() },
          }),
        ]);
        assert.equal(
          outcomes.filter((x) => x.status === 'fulfilled').length,
          1,
        );
      },
    );
    await t.test(
      'TTL configurado, contexto revogado e falha de auditoria desfazem criação',
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
        const config = { ttlSeconds: 90 } as HoldConfig;
        const held = await new HoldRepository(database, auth, config).create(
          createHoldDto(payload(16)),
        );
        const persisted = await client.appointmentHold.findUniqueOrThrow({
          where: { id: held.id },
        });
        assert.equal(+persisted.expiresAt - +persisted.createdAt, 90000);
        const original = auth.requirePermissions.bind(auth);
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
            new HoldRepository(database, auth, config).create(
              createHoldDto(payload(17)),
            ),
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
        const failed = payload(17);
        await assert.rejects(
          new HoldRepository(failing, auth, config).create(
            createHoldDto(failed),
          ),
        );
        assert.equal(
          await client.appointmentHold.count({
            where: { tenantId: ta.id, requestId: failed.requestId },
          }),
          0,
        );
        const empty = new AuthorizationService(
          database,
          new TenantContext({} as AuthRequest, database),
        );
        const repository = new HoldRepository(database, empty, config);
        await assert.rejects(repository.find(first.id));
        await assert.rejects(
          new HoldsService(empty, repository).create(payload(17)),
        );
      },
    );
  } finally {
    await app.close();
    await app2.close();
    await client.$disconnect();
  }
});
