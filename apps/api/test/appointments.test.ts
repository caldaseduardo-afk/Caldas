import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  assertTransition,
  states,
} from '../src/appointments/appointment.state';
import {
  appointmentDto,
  conversionDto,
  rescheduleDto,
  cancellationDto,
  statusDto,
  appointmentsQuery,
} from '../src/appointments/appointment.dto';
test('máquina de estados rejeita todas as transições não definidas e respeita tempo', () => {
  const start = new Date('2020-01-01T10:00:00Z'),
    end = new Date('2020-01-01T11:00:00Z'),
    now = new Date('2020-01-01T12:00:00Z');
  const allowed = new Set([
    'PENDING_CONFIRMATION:CONFIRMED',
    'PENDING_CONFIRMATION:CANCELLED',
    'PENDING_CONFIRMATION:RESCHEDULED',
    'CONFIRMED:CHECKED_IN',
    'CONFIRMED:CANCELLED',
    'CONFIRMED:RESCHEDULED',
    'CONFIRMED:NO_SHOW',
    'CHECKED_IN:COMPLETED',
  ]);
  for (const from of states)
    for (const to of states) {
      const call = () => assertTransition(from, to, start, end, now);
      if (allowed.has(`${from}:${to}`)) assert.doesNotThrow(call);
      else assert.throws(call);
    }
  assert.throws(() =>
    assertTransition(
      'CONFIRMED',
      'NO_SHOW',
      start,
      end,
      new Date('2020-01-01T09:00:00Z'),
    ),
  );
  assert.throws(() =>
    assertTransition(
      'CONFIRMED',
      'CHECKED_IN',
      start,
      end,
      new Date('2020-01-01T09:00:00Z'),
    ),
  );
  assert.throws(() =>
    assertTransition('CHECKED_IN', 'COMPLETED', start, end, start),
  );
  assert.doesNotThrow(() =>
    assertTransition('CHECKED_IN', 'COMPLETED', start, end, end),
  );
});
test('DTOs de consulta não aceitam autoria/tenant/integração, horários sem offset ou atualização genérica', () => {
  const dto = {
    patientId: randomUUID(),
    providerId: randomUUID(),
    unitId: randomUUID(),
    serviceId: randomUUID(),
    startAt: '2035-01-01T14:00:00-03:00',
  };
  assert.equal(
    appointmentDto(dto).startAt.toISOString(),
    '2035-01-01T17:00:00.000Z',
  );
  assert.equal(appointmentDto(dto).source, 'MANUAL');
  for (const extra of [
    { tenantId: randomUUID() },
    { createdById: randomUUID() },
    { status: 'CONFIRMED' },
    { calendarProvider: 'google' },
    { source: 'IMPORT' },
    { notes: 'a'.repeat(2001) },
    { startAt: '2035-01-01T14:00:00' },
    { endAt: dto.startAt },
  ])
    assert.throws(() => appointmentDto({ ...dto, ...extra }));
  assert.throws(() =>
    conversionDto({ holdId: randomUUID(), patientId: randomUUID() }),
  );
  assert.throws(() => rescheduleDto(dto));
  assert.throws(() => statusDto({ status: 'RESCHEDULED' }));
  assert.throws(() => cancellationDto({ reason: 'a'.repeat(1001) }));
  assert.deepEqual(cancellationDto({ reason: ' motivo ' }), {
    reason: 'motivo',
  });
  assert.throws(() =>
    appointmentsQuery({
      startAt: dto.startAt,
      endAt: '2035-03-01T14:00:00-03:00',
    }),
  );
  assert.throws(() =>
    appointmentsQuery({
      startAt: dto.startAt,
      endAt: '2035-01-02T14:00:00-03:00',
      tenantId: randomUUID(),
    }),
  );
});
