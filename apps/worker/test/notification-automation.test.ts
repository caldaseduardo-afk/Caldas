import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  notificationCycleKey,
  notificationJobId,
  parseNotificationPayload,
  reconciliationHorizon,
  resolveNotificationSchedule,
  resolveRetrySchedule,
  workerConcurrency,
} from '@atendente/database';

const time = (value: string) => new Date(`1970-01-01T${value}:00.000Z`);
const rule = {
  id: randomUUID(),
  updatedAt: new Date('2026-10-11T12:00:00Z'),
  type: 'CONFIRMATION' as const,
  offsetMinutes: 240,
  allowedStartTime: time('08:00'),
  allowedEndTime: time('20:00'),
  allowedWeekdays: [
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
  ] as const,
  outsideWindowPolicy: 'PREVIOUS_ALLOWED_TIME' as const,
  retryEnabled: true,
  retryAfterMinutes: 240,
  maxAttempts: 2,
  minimumTimeBeforeAppointment: 60,
  actionIfNoResponse: 'NONE' as const,
  active: true,
};

test('cenário crítico usa segunda 20:00 e retry não viola política temporal', () => {
  const start = new Date('2026-10-13T11:00:00.000Z'); // terça 08:00 São Paulo
  assert.deepEqual(
    resolveNotificationSchedule(start, 'America/Sao_Paulo', {
      ...rule,
      allowedWeekdays: [...rule.allowedWeekdays],
    }),
    {
      decision: 'SCHEDULE',
      scheduledAt: '2026-10-12T23:00:00.000Z',
      reason: null,
    },
  );
  assert.deepEqual(
    resolveRetrySchedule(
      new Date('2026-10-12T23:00:00.000Z'),
      start,
      'America/Sao_Paulo',
      { ...rule, allowedWeekdays: [...rule.allowedWeekdays] },
      2,
    ),
    { decision: 'SKIP', scheduledAt: null, reason: 'NON_FORWARD_RETRY' },
  );
});

test('payload mínimo, jobId e ciclo são determinísticos e validados', () => {
  const payload = {
    tenantId: randomUUID(),
    appointmentId: randomUUID(),
    notificationRuleId: rule.id,
    attemptId: randomUUID(),
    cycleKey: notificationCycleKey(
      { id: randomUUID(), startAt: new Date('2035-01-02T11:00:00Z') },
      { ...rule, allowedWeekdays: [...rule.allowedWeekdays] },
    ),
    attemptNumber: 1,
    correlationId: randomUUID(),
  };
  assert.deepEqual(parseNotificationPayload(payload), payload);
  assert.equal(notificationJobId(payload), notificationJobId(payload));
  assert.throws(() =>
    parseNotificationPayload({ ...payload, accessToken: 'secret' }),
  );
  assert.throws(() =>
    parseNotificationPayload({
      ...payload,
      tenantId: randomUUID(),
      appointmentId: 'bad',
    }),
  );
});

test('configuração limita concorrência e horizonte', () => {
  assert.equal(workerConcurrency(undefined), 4);
  assert.equal(reconciliationHorizon(undefined), 30);
  for (const value of ['0', '65', '1.5', 'x'])
    assert.throws(() => workerConcurrency(value));
  for (const value of ['0', '367', '1.5', 'x'])
    assert.throws(() => reconciliationHorizon(value));
});
