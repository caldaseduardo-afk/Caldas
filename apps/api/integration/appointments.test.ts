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
import {
  weekdays,
  civilDate,
  localTime,
} from '../src/availability/availability.dto';
import { AppointmentRepository } from '../src/appointments/appointment.repository';
import { RealtimeEvents } from '../src/realtime/realtime.events';
import {
  appointmentDto,
  conversionDto,
  rescheduleDto,
} from '../src/appointments/appointment.dto';
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

test('Consultas: conversão, estados, histórico, isolamento e concorrência PostgreSQL', async (t) => {
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
    await client.providerUnit.create({
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
    const expire = (id: string) =>
      client.appointmentHold.update({
        where: { id },
        data: {
          createdAt: new Date(Date.now() - 120000),
          expiresAt: new Date(Date.now() - 60000),
        },
      });
    type Appointment = Hold & {
      source: string;
      createdByType: string;
      createdById: string;
      syncStatus: string;
      calendarProvider: null;
      externalEventId: null;
      previousAppointmentId: string | null;
      holdId: string | null;
      notes: string | null;
      cancelledAt: string | null;
      cancellationReason: string | null;
    };
    const direct = (
      day: number,
      time = '14:00',
      extra: Record<string, unknown> = {},
    ) => {
      const { requestId: _requestId, ...dto } = payload(day, time, extra);
      void _requestId;
      return dto;
    };
    const book = async (dto: unknown, cookie = a) => {
      const r = await request('/appointments', cookie, 'POST', dto);
      assert.equal(r.status, 201, await r.clone().text());
      return (await r.json()) as Appointment;
    };
    const convert = (id: string, cookie = a, server = url) =>
      request(
        '/appointments/from-hold',
        cookie,
        'POST',
        { holdId: id },
        server,
      );
    const change = (id: string, status: string, cookie = a) =>
      request(`/appointments/${id}/status`, cookie, 'POST', { status });
    const cancel = (id: string, cookie = a) =>
      request(`/appointments/${id}/cancel`, cookie, 'POST', {
        reason: 'Pedido do paciente',
      });
    const move = (id: string, day: number, time = '14:00', cookie = a) =>
      request(`/appointments/${id}/reschedule`, cookie, 'POST', {
        providerId: pra.id,
        serviceId: service.id,
        unitId: ua.id,
        startAt: at(day, time),
      });
    let first: Appointment, foreign: Appointment;
    await t.test(
      'converte HOLD atomically e preserva ids, UTC, source/ator/sync e projeção',
      async () => {
        const hold = await create(payload(1, '14:00', { contactId: ca.id }));
        const r = await request('/appointments/from-hold', a, 'POST', {
          holdId: hold.id,
          source: 'PHONE',
          notes: 'Nota interna',
        });
        assert.equal(r.status, 201, await r.clone().text());
        first = (await r.json()) as Appointment;
        for (const key of [
          'patientId',
          'providerId',
          'serviceId',
          'unitId',
          'contactId',
          'startAt',
          'endAt',
        ] as const)
          assert.equal(first[key], hold[key]);
        assert.equal(first.holdId, hold.id);
        assert.equal(first.status, 'PENDING_CONFIRMATION');
        assert.equal(first.source, 'PHONE');
        assert.equal(first.createdByType, 'USER');
        assert.equal(first.createdById, users[0]!.id);
        assert.equal(first.syncStatus, 'NOT_REQUIRED');
        assert.equal(first.calendarProvider, null);
        assert.equal(first.externalEventId, null);
        assert.equal(first.startAt, '2035-01-01T17:00:00.000Z');
        assert.equal(first.endAt, '2035-01-01T17:40:00.000Z');
        assert.equal(
          (
            await client.appointmentHold.findUniqueOrThrow({
              where: { id: hold.id },
            })
          ).status,
          'CONSUMED',
        );
        assert.equal((await convert(hold.id)).status, 409);
        for (const field of [
          'tenantId',
          'occupiedStartAt',
          'occupiedEndAt',
          'creatorId',
          'requestId',
        ])
          assert.ok(!(field in first));
        foreign = await book(
          direct(1, '14:00', {
            patientId: pb.id,
            providerId: prb.id,
            serviceId: foreignService.id,
            unitId: ub.id,
          }),
          b,
        );
      },
    );
    await t.test(
      'HOLD vencido/released/estrangeiro e mudança de duração não convertem',
      async () => {
        const expired = await create(payload(2));
        await expire(expired.id);
        assert.equal((await convert(expired.id)).status, 409);
        const released = await create(payload(2, '15:00'));
        assert.equal(
          (
            await request(
              `/appointment-holds/${released.id}/release`,
              a,
              'POST',
            )
          ).status,
          200,
        );
        assert.equal((await convert(released.id)).status, 409);
        const foreignHold = await create(
          payload(2, '16:00', {
            patientId: pb.id,
            providerId: prb.id,
            serviceId: foreignService.id,
            unitId: ub.id,
          }),
          b,
        );
        assert.equal((await convert(foreignHold.id)).status, 404);
        const changed = await create(payload(2, '17:00'));
        await client.providerService.update({
          where: { id: ps.id },
          data: { durationOverrideMinutes: 45 },
        });
        assert.equal((await convert(changed.id)).status, 409);
        await client.providerService.update({
          where: { id: ps.id },
          data: { durationOverrideMinutes: null },
        });
      },
    );
    await t.test(
      'rejeita entidades cross-tenant, falta de habilitação/vínculo e dados forjados',
      async () => {
        for (const extra of [
          { patientId: pb.id },
          { providerId: prb.id },
          { serviceId: foreignService.id },
          { unitId: ub.id },
          { contactId: cb.id },
          { unitId: uMissing.id },
          { serviceId: noSkill.id },
        ])
          assert.equal(
            (
              await request(
                '/appointments',
                a,
                'POST',
                direct(3, '14:00', extra),
              )
            ).status,
            404,
          );
        for (const extra of [
          { tenantId: tb.id },
          { createdById: users[1]!.id },
          { createdByType: 'AI' },
          { syncStatus: 'SYNCED' },
          { externalEventId: 'fake' },
          { source: 'WHATSAPP_AI' },
          { endAt: at(3) },
          { endAt: at(3, '14:10') },
        ])
          assert.equal(
            (
              await request(
                '/appointments',
                a,
                'POST',
                direct(3, '14:00', extra),
              )
            ).status,
            400,
          );
        await client.contactPatient.updateMany({
          where: { tenantId: ta.id, contactId: ca.id },
          data: { authorizationLevel: 'NO_ACCESS' },
        });
        assert.equal(
          (
            await request(
              '/appointments',
              a,
              'POST',
              direct(3, '14:00', { contactId: ca.id }),
            )
          ).status,
          404,
        );
        await client.contactPatient.updateMany({
          where: { tenantId: ta.id, contactId: ca.id },
          data: { authorizationLevel: 'SCHEDULING_ONLY' },
        });
      },
    );
    await t.test(
      'disponibilidade recorrente, BLOCK, EXTRA e duração override',
      async () => {
        assert.equal(
          (await request('/appointments', a, 'POST', direct(4, '06:00')))
            .status,
          409,
        );
        await client.scheduleException.create({
          data: {
            tenantId: ta.id,
            providerId: pra.id,
            unitId: ua.id,
            date: civilDate('2035-01-04'),
            startTime: localTime('14:00'),
            endTime: localTime('15:00'),
            type: 'BLOCK',
          },
        });
        assert.equal(
          (await request('/appointments', a, 'POST', direct(4))).status,
          409,
        );
        await client.scheduleException.create({
          data: {
            tenantId: ta.id,
            providerId: pra.id,
            unitId: ua.id,
            date: civilDate('2035-01-04'),
            startTime: localTime('21:00'),
            endTime: localTime('22:00'),
            type: 'EXTRA_AVAILABILITY',
          },
        });
        await client.providerService.update({
          where: { id: ps.id },
          data: { durationOverrideMinutes: 45 },
        });
        const row = await book(direct(4, '21:00'));
        assert.equal(
          Date.parse(row.endAt) - Date.parse(row.startAt),
          45 * 60000,
        );
        await client.providerService.update({
          where: { id: ps.id },
          data: { durationOverrideMinutes: null },
        });
      },
    );
    await t.test(
      'Appointment bloqueia HOLD e Appointment; HOLD vivo bloqueia consulta e expirado libera',
      async () => {
        await book(direct(5));
        assert.equal(
          (await request('/appointments', a, 'POST', direct(5, '14:20')))
            .status,
          409,
        );
        assert.equal(
          (await request('/appointment-holds', a, 'POST', payload(5, '14:20')))
            .status,
          409,
        );
        await book(direct(5, '14:40'));
        const h = await create(payload(6));
        assert.equal(
          (await request('/appointments', a, 'POST', direct(6))).status,
          409,
        );
        await expire(h.id);
        await book(direct(6));
        assert.equal((await change(first.id, 'CONFIRMED')).status, 200);
        assert.equal(
          (await request('/appointments', a, 'POST', direct(1))).status,
          409,
        );
      },
    );
    await t.test(
      'buffers antes/depois persistem na consulta após alteração do Service',
      async () => {
        await client.service.update({
          where: { id: service.id },
          data: { bufferBeforeMinutes: 10, bufferAfterMinutes: 10 },
        });
        await book(direct(7));
        await client.service.update({
          where: { id: service.id },
          data: { bufferBeforeMinutes: 0, bufferAfterMinutes: 0 },
        });
        for (const time of ['13:20', '14:40'])
          assert.equal(
            (await request('/appointments', a, 'POST', direct(7, time))).status,
            409,
          );
        await book(direct(7, '14:50'));
      },
    );
    await t.test(
      'cancelamento preserva registro, auditoria/ator/motivo e libera ocupação; terminal não volta',
      async () => {
        const row = await book(direct(8));
        const r = await cancel(row.id);
        assert.equal(r.status, 200);
        const cancelled = (await r.json()) as Appointment;
        assert.equal(cancelled.status, 'CANCELLED');
        assert.ok(cancelled.cancelledAt);
        assert.equal(cancelled.cancellationReason, 'Pedido do paciente');
        assert.equal((await cancel(row.id)).status, 200);
        assert.equal((await change(row.id, 'CONFIRMED')).status, 409);
        await book(direct(8));
        const events = await client.authEvent.findMany({
          where: {
            tenantId: ta.id,
            resourceId: row.id,
            type: 'APPOINTMENT_CANCELLED',
          },
        });
        assert.equal(events.length, 1);
        assert.equal(events[0]!.userId, users[0]!.id);
        assert.ok(!JSON.stringify(events[0]!.changes).includes('Pedido'));
      },
    );
    await t.test(
      'remarcação transacional preserva cadeia, libera original e rollback no conflito',
      async () => {
        const original = await book(direct(9));
        const r = await move(original.id, 10);
        assert.equal(r.status, 201, await r.clone().text());
        const next = (await r.json()) as Appointment;
        assert.equal(next.previousAppointmentId, original.id);
        assert.equal(next.patientId, pa.id);
        assert.equal(
          (
            await client.appointment.findUniqueOrThrow({
              where: { id: original.id },
            })
          ).status,
          'RESCHEDULED',
        );
        await book(direct(9));
        const lastResponse = await move(next.id, 11);
        assert.equal(lastResponse.status, 201);
        const last = (await lastResponse.json()) as Appointment;
        assert.equal(last.previousAppointmentId, next.id);
        assert.equal((await move(original.id, 12)).status, 409);
        assert.equal((await move(last.id, 9)).status, 409);
        assert.equal(
          (
            await client.appointment.findUniqueOrThrow({
              where: { id: last.id },
            })
          ).status,
          'PENDING_CONFIRMATION',
        );
        assert.equal(
          await client.appointment.count({
            where: { previousAppointmentId: last.id },
          }),
          0,
        );
        const same = await book(direct(12));
        assert.equal((await move(same.id, 12)).status, 201);
      },
    );
    await t.test(
      'estados e limites temporais: confirmação, chegada, conclusão e ausência',
      async () => {
        const future = await book(direct(13));
        assert.equal((await change(future.id, 'CONFIRMED')).status, 200);
        assert.equal((await change(future.id, 'CHECKED_IN')).status, 409);
        assert.equal((await change(future.id, 'NO_SHOW')).status, 409);
        // Operational transitions use persisted historical appointments; no clock mocking.
        const historicalNow = Date.now();
        const historical = async (
          status: 'CONFIRMED' | 'CHECKED_IN',
          offset: number,
        ) =>
          client.appointment.create({
            data: {
              tenantId: ta.id,
              patientId: pa.id,
              providerId: pra.id,
              unitId: ua.id,
              serviceId: service.id,
              createdByType: 'USER',
              createdById: users[0]!.id,
              status,
              startAt: new Date(historicalNow - offset - 3600000),
              endAt: new Date(historicalNow - offset),
              occupiedStartAt: new Date(historicalNow - offset - 3600000),
              occupiedEndAt: new Date(historicalNow - offset),
            },
          });
        const row = await historical('CONFIRMED', 7200000);
        assert.equal((await change(row.id, 'CHECKED_IN')).status, 200);
        const { id: historicalId, ...checkedIn } =
          await client.appointment.findUniqueOrThrow({ where: { id: row.id } });
        void historicalId;
        await assert.rejects(client.appointment.create({ data: checkedIn }));

        assert.equal((await cancel(row.id)).status, 409);
        assert.equal((await change(row.id, 'COMPLETED')).status, 200);
        assert.equal((await change(row.id, 'CONFIRMED')).status, 409);
        assert.equal(
          (await change(row.id, 'PENDING_CONFIRMATION')).status,
          400,
        );
        const absent = await historical('CONFIRMED', 14400000);
        assert.equal((await change(absent.id, 'NO_SHOW')).status, 200);
        assert.equal((await change(absent.id, 'CONFIRMED')).status, 409);
        // Historical terminal rows do not participate in the occupancy constraint.
        await client.appointment.create({
          data: {
            tenantId: ta.id,
            patientId: pa.id,
            providerId: pra.id,
            unitId: ua.id,
            serviceId: service.id,
            createdByType: 'USER',
            createdById: users[0]!.id,
            status: 'NO_SHOW',
            startAt: new Date(at(14)),
            endAt: new Date(at(14, '14:40')),
            occupiedStartAt: new Date(at(14)),
            occupiedEndAt: new Date(at(14, '14:40')),
          },
        });
        await book(direct(14));
      },
    );
    await t.test(
      'isolamento leitura/cancelamento/remarcação/lista, RBAC e CSRF',
      async (t) => {
        const published: unknown[] = [];
        const unsubscribe = app
          .get(RealtimeEvents)
          .subscribe((event) => published.push(event));
        t.after(unsubscribe);
        const foreignBefore = await client.appointment.findUniqueOrThrow({
          where: { id: foreign.id },
          select: { status: true },
        });
        const confirmationAuditBefore = await client.authEvent.count({
          where: {
            tenantId: tb.id,
            resourceId: foreign.id,
            type: 'APPOINTMENT_CONFIRMED',
          },
        });
        for (const endpoint of [
          `/appointments/${foreign.id}`,
          `/appointments/${foreign.id}/cancel`,
          `/appointments/${foreign.id}/reschedule`,
        ])
          assert.equal(
            (
              await request(
                endpoint,
                a,
                endpoint.endsWith(foreign.id) ? 'GET' : 'POST',
                endpoint.endsWith('reschedule')
                  ? {
                      serviceId: service.id,
                      providerId: pra.id,
                      unitId: ua.id,
                      startAt: at(15),
                    }
                  : undefined,
              )
            ).status,
            404,
          );
        assert.equal(
          (
            await change(foreign.id, 'CONFIRMED')
          ).status,
          404,
        );
        assert.deepEqual(
          await client.appointment.findUniqueOrThrow({
            where: { id: foreign.id },
            select: { status: true },
          }),
          foreignBefore,
        );
        assert.equal(
          await client.authEvent.count({
            where: {
              tenantId: tb.id,
              resourceId: foreign.id,
              type: 'APPOINTMENT_CONFIRMED',
            },
          }),
          confirmationAuditBefore,
        );
        assert.deepEqual(published, []);
        const list = await request(
          `/appointments?${new URLSearchParams({ startAt: at(1, '00:00'), endAt: at(31, '23:59') })}`,
          a,
        );
        assert.equal(list.status, 200);
        const rows = (await list.json()) as Appointment[];
        assert.ok(rows.length > 0);
        assert.ok(rows.every((x) => x.patientId === pa.id));
        assert.ok(rows.every((x) => !('notes' in x) && !('createdById' in x)));
        const calendarResponse = await request(
          `/appointments/calendar?${new URLSearchParams({ startAt: at(1, '00:00'), endAt: at(31, '23:59') })}`,
          a,
        );
        assert.equal(calendarResponse.status, 200);
        const calendarRows = (await calendarResponse.json()) as Array<{
          id: string;
          patient: { name: string };
          service: { name: string };
          provider: { name: string };
          unit: { name: string };
          notes?: string | null;
          cancellationReason?: string | null;
        }>;
        assert.ok(calendarRows.length > 0);
        assert.ok(calendarRows.every((x) => x.patient.name === 'Paciente A'));
        assert.ok(calendarRows.every((x) => x.service.name === 'Consulta'));
        assert.ok(calendarRows.every((x) => x.provider.name === 'Profissional A'));
        assert.ok(calendarRows.every((x) => x.unit.name === 'Unidade A'));
        assert.ok(calendarRows.every((x) => !('notes' in x) && !('cancellationReason' in x)));
        assert.ok(!calendarRows.some((x) => x.patient.name === 'Paciente B'));
        assert.equal(
          (await request('/appointments/calendar?startAt=invalid&endAt=invalid', doctor)).status,
          400,
        );
        assert.equal(
          (await request(`/appointments/${first.id}`, doctor)).status,
          200,
        );
        assert.equal(
          (await request('/appointments', doctor, 'POST', direct(15))).status,
          403,
        );
        assert.equal((await cancel(first.id, doctor)).status, 403);
        assert.equal((await change(first.id, 'CONFIRMED', doctor)).status, 403);
        assert.equal((await move(first.id, 15, '14:00', doctor)).status, 403);
        assert.equal((await request(`/appointments/${first.id}`)).status, 401);
        assert.equal(
          (
            await request('/appointments', a, 'POST', direct(15), url, {
              Origin: 'https://evil.test',
            })
          ).status,
          403,
        );
        assert.equal(
          (await request('/appointments', admin, 'POST', direct(15, '16:00')))
            .status,
          201,
        );
      },
    );
    await t.test(
      'duas instâncias: consulta/consulta, consulta/HOLD e conversão/conversão',
      async () => {
        const results = await Promise.all([
          request('/appointments', a, 'POST', direct(16)),
          request('/appointments', a, 'POST', direct(16), url2),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
        const mixed = await Promise.all([
          request('/appointments', a, 'POST', direct(17)),
          request('/appointment-holds', a, 'POST', payload(17), url2),
        ]);
        assert.deepEqual(mixed.map((r) => r.status).sort(), [201, 409]);
        const h = await create(payload(18));
        const conversion = await Promise.all([
          convert(h.id),
          convert(h.id, a, url2),
        ]);
        assert.deepEqual(conversion.map((r) => r.status).sort(), [201, 409]);
        assert.equal(
          await client.appointment.count({
            where: { tenantId: ta.id, holdId: h.id },
          }),
          1,
        );
      },
    );
    await t.test(
      'FKs, CHECKs, EXCLUDE e trigger cruzado protegem SQL direto concorrente',
      async () => {
        const source = await client.appointment.findUniqueOrThrow({
          where: { id: first.id },
        });
        const { id: _id, ...base } = source;
        void _id;
        const raw = {
          ...base,
          holdId: null,
          previousAppointmentId: null,
          contactId: null,
          status: 'PENDING_CONFIRMATION' as const,
          startAt: new Date(at(19)),
          endAt: new Date(at(19, '14:40')),
          occupiedStartAt: new Date(at(19)),
          occupiedEndAt: new Date(at(19, '14:40')),
        };
        for (const patch of [
          { patientId: pb.id },
          { providerId: prb.id },
          { unitId: ub.id },
          { serviceId: foreignService.id },
          { contactId: cb.id },
          { createdById: users[1]!.id },
          { endAt: raw.startAt },
          { createdByType: 'SYSTEM' as const },
          { syncStatus: 'SYNCED' as const },
          { previousAppointmentId: foreign.id },
        ])
          await assert.rejects(
            client.appointment.create({ data: { ...raw, ...patch } }),
          );
        const result = await Promise.allSettled([
          client.appointment.create({ data: raw }),
          client.appointment.create({ data: raw }),
        ]);
        assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
        const holdData = {
          tenantId: ta.id,
          patientId: pa.id,
          providerId: pra.id,
          unitId: ua.id,
          serviceId: service.id,
          creatorId: users[0]!.id,
          requestId: randomUUID(),
          startAt: new Date(at(20)),
          endAt: new Date(at(20, '14:40')),
          occupiedStartAt: new Date(at(20)),
          occupiedEndAt: new Date(at(20, '14:40')),
          expiresAt: new Date(Date.now() + 300000),
        };
        const mixed = await Promise.allSettled([
          client.appointment.create({
            data: {
              ...raw,
              startAt: holdData.startAt,
              endAt: holdData.endAt,
              occupiedStartAt: holdData.occupiedStartAt,
              occupiedEndAt: holdData.occupiedEndAt,
            },
          }),
          client.appointmentHold.create({ data: holdData }),
        ]);
        assert.equal(mixed.filter((r) => r.status === 'fulfilled').length, 1);
        await assert.rejects(
          client.appointmentHold.create({
            data: {
              ...holdData,
              requestId: randomUUID(),
              startAt: raw.startAt,
              endAt: raw.endAt,
              occupiedStartAt: raw.occupiedStartAt,
              occupiedEndAt: raw.occupiedEndAt,
            },
          }),
        );
      },
    );
    await t.test(
      'conversão revalida bloqueio, contato revogado e vínculo profissional',
      async () => {
        const h = await create(payload(24, '14:00', { contactId: ca.id }));
        const block = await client.scheduleException.create({
          data: {
            tenantId: ta.id,
            providerId: pra.id,
            unitId: ua.id,
            date: civilDate('2035-01-24'),
            type: 'VACATION',
          },
        });
        assert.equal((await convert(h.id)).status, 409);
        await client.scheduleException.update({
          where: { id: block.id },
          data: { active: false },
        });
        await client.contactPatient.updateMany({
          where: { tenantId: ta.id, contactId: ca.id },
          data: { authorizationLevel: 'NO_ACCESS' },
        });
        assert.equal((await convert(h.id)).status, 404);
        await client.contactPatient.updateMany({
          where: { tenantId: ta.id, contactId: ca.id },
          data: { authorizationLevel: 'SCHEDULING_ONLY' },
        });
        await client.providerService.update({
          where: { id: ps.id },
          data: { active: false },
        });
        assert.equal((await convert(h.id)).status, 404);
        await client.providerService.update({
          where: { id: ps.id },
          data: { active: true },
        });
        assert.equal(
          (
            await client.appointmentHold.findUniqueOrThrow({
              where: { id: h.id },
            })
          ).status,
          'ACTIVE',
        );
        assert.equal((await convert(h.id)).status, 201);
      },
    );
    await t.test(
      'auditoria falha: rollback da conversão e remarcação; revogação/ausência de contexto',
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
        const failing = {
          client: {
            $transaction: (
              fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
              options: { isolationLevel: 'Serializable' },
            ) =>
              client.$transaction(
                (tx) =>
                  fn(
                    new Proxy(tx, {
                      get(target, key) {
                        if (key === 'authEvent')
                          return {
                            create: async () => {
                              throw new Error('Audit unavailable');
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
        const repo = new AppointmentRepository(failing, auth);
        const h = await create(payload(21));
        await assert.rejects(repo.convert(conversionDto({ holdId: h.id })));
        assert.equal(
          (
            await client.appointmentHold.findUniqueOrThrow({
              where: { id: h.id },
            })
          ).status,
          'ACTIVE',
        );
        assert.equal(
          await client.appointment.count({ where: { holdId: h.id } }),
          0,
        );
        const original = await book(direct(22));
        await assert.rejects(
          repo.reschedule(
            original.id,
            rescheduleDto({
              serviceId: service.id,
              providerId: pra.id,
              unitId: ua.id,
              startAt: at(23),
            }),
          ),
        );
        assert.equal(
          (
            await client.appointment.findUniqueOrThrow({
              where: { id: original.id },
            })
          ).status,
          'PENDING_CONFIRMATION',
        );
        assert.equal(
          await client.appointment.count({
            where: { previousAppointmentId: original.id },
          }),
          0,
        );
        const originalRequire = auth.requirePermissions.bind(auth);
        auth.requirePermissions = async (...permissions) => {
          const scope = await originalRequire(...permissions);
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
            new AppointmentRepository(database, auth).create(
              appointmentDto(direct(23)),
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
        }
        const empty = new AuthorizationService(
          database,
          new TenantContext({} as AuthRequest, database),
        );
        await assert.rejects(
          new AppointmentRepository(database, empty).find(first.id),
        );
      },
    );
    await t.test(
      'TASK-030 E2E humano: AGENT assume conversa e cancela consulta confirmada',
      async () => {
        const conversation = await client.conversation.create({
          data: {
            tenantId: ta.id,
            contactId: ca.id,
            status: 'NEEDS_HUMAN',
            handoffReason: 'OTHER',
            handoffRequestedAt: new Date(),
            channel: 'WHATSAPP',
          },
        });
        const claimed = await request(
          `/conversations/${conversation.id}/claim`,
          a,
          'POST',
          {},
        );
        assert.equal(claimed.status, 200, await claimed.clone().text());
        const appointment = await book(direct(31, '18:30'));
        assert.equal((await change(appointment.id, 'CONFIRMED')).status, 200);
        assert.equal((await cancel(appointment.id)).status, 200);
        const claimAudit = await client.authEvent.findFirstOrThrow({
          where: {
            tenantId: ta.id,
            resourceId: conversation.id,
            type: 'CONVERSATION_CLAIMED',
          },
        });
        const cancelAudit = await client.authEvent.findFirstOrThrow({
          where: {
            tenantId: ta.id,
            resourceId: appointment.id,
            type: 'APPOINTMENT_CANCELLED',
          },
        });
        for (const event of [claimAudit, cancelAudit]) {
          assert.equal(event.actorType, 'USER');
          assert.equal(event.userId, users[0]!.id);
          assert.equal(event.source, 'WEB');
          assert.equal(event.isBusiness, true);
        }
        assert.deepEqual(cancelAudit.previousValues, { status: 'CONFIRMED' });
        assert.deepEqual(cancelAudit.newValues, { status: 'CANCELLED' });
        assert.deepEqual(claimAudit.newValues, {
          status: 'HUMAN_ACTIVE',
          assignedUserId: users[0]!.id,
        });
        assert(!JSON.stringify([claimAudit, cancelAudit]).includes(password));
      },
    );
  } finally {
    await app.close();
    await app2.close();
    await client.$disconnect();
  }
});
