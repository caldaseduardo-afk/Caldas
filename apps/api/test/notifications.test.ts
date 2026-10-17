import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { localTime, weekdays } from '../src/availability/availability.dto';
import {
  createNotificationDto,
  updateNotificationDto,
  validateNotificationRule,
  previewDto,
  resolutionDto,
  notificationFilter,
} from '../src/notifications/notification.dto';
import {
  resolveNotificationSchedule as resolve,
  resolveRetrySchedule as retry,
  type NotificationRuleData,
} from '../src/notifications/notification.schedule';
const base: NotificationRuleData = {
  type: 'CONFIRMATION',
  offsetMinutes: 240,
  allowedStartTime: localTime('08:00'),
  allowedEndTime: localTime('20:00'),
  allowedWeekdays: [...weekdays],
  outsideWindowPolicy: 'PREVIOUS_ALLOWED_TIME',
  retryEnabled: true,
  retryAfterMinutes: 240,
  maxAttempts: 2,
  minimumTimeBeforeAppointment: 0,
  actionIfNoResponse: 'NONE',
  active: true,
};
const date = (s: string) => new Date(s);
const schedule = (s: string) => ({
  decision: 'SCHEDULE',
  scheduledAt: s,
  reason: null,
});
const skipped = (reason: string) => ({
  decision: 'SKIP',
  scheduledAt: null,
  reason,
});
const utc = (s: string, rule: Partial<NotificationRuleData> = {}) =>
  resolve(date(s), 'UTC', { ...base, ...rule });
test('consulta terça 08:00 - 4h: PREVIOUS segunda20, NEXT sem utilidade, SKIP', () => {
  const appt = date('2026-10-06T11:00:00Z');
  assert.deepEqual(
    resolve(appt, 'America/Sao_Paulo', base),
    schedule('2026-10-05T23:00:00.000Z'),
  );
  assert.deepEqual(
    resolve(appt, 'America/Sao_Paulo', {
      ...base,
      outsideWindowPolicy: 'NEXT_ALLOWED_TIME',
    }),
    skipped('AT_OR_AFTER_APPOINTMENT'),
  );
  assert.deepEqual(
    resolve(appt, 'America/Sao_Paulo', {
      ...base,
      outsideWindowPolicy: 'SKIP',
    }),
    skipped('OUTSIDE_ALLOWED_WINDOW'),
  );
});
test('alvo dentro da janela e limites inclusivos preservam instante; offset zero nunca envia no início', () => {
  assert.deepEqual(
    utc('2026-10-06T16:00:00Z'),
    schedule('2026-10-06T12:00:00.000Z'),
  );
  assert.deepEqual(
    utc('2026-10-06T12:00:00Z'),
    schedule('2026-10-06T08:00:00.000Z'),
  );
  assert.deepEqual(
    utc('2026-10-07T00:00:00Z'),
    schedule('2026-10-06T20:00:00.000Z'),
  );
  assert.deepEqual(
    utc('2026-10-06T16:00:00Z', { offsetMinutes: 0 }),
    skipped('AT_OR_AFTER_APPOINTMENT'),
  );
});
test('fora após fechamento encontra anterior20 ou próximo08, inclusive mudança de ano', () => {
  const appt = '2027-01-01T12:00:00Z';
  assert.deepEqual(
    utc(appt, { offsetMinutes: 780 }),
    schedule('2026-12-31T20:00:00.000Z'),
  );
  assert.deepEqual(
    utc(appt, { offsetMinutes: 780, outsideWindowPolicy: 'NEXT_ALLOWED_TIME' }),
    schedule('2027-01-01T08:00:00.000Z'),
  );
});
test('domingo desabilitado procura sábado20 ou segunda08; não se limita ao mesmo dia', () => {
  const allowedWeekdays = weekdays.filter((x) => x !== 'SUNDAY');
  assert.deepEqual(
    utc('2026-10-05T08:00:00Z', { offsetMinutes: 1440, allowedWeekdays }),
    schedule('2026-10-03T20:00:00.000Z'),
  );
  assert.deepEqual(
    utc('2026-10-05T12:00:00Z', {
      offsetMinutes: 1680,
      allowedWeekdays,
      outsideWindowPolicy: 'NEXT_ALLOWED_TIME',
    }),
    schedule('2026-10-05T08:00:00.000Z'),
  );
  assert.deepEqual(
    utc('2026-10-05T08:00:00Z', {
      offsetMinutes: 1440,
      allowedWeekdays,
      outsideWindowPolicy: 'SKIP',
    }),
    skipped('OUTSIDE_ALLOWED_WINDOW'),
  );
  assert.deepEqual(
    utc('2026-10-05T08:00:00Z', {
      offsetMinutes: 1440,
      allowedWeekdays: ['MONDAY'],
    }),
    schedule('2026-09-28T20:00:00.000Z'),
  );
});
test('mínimo é inclusivo e aplicado após ajuste; próximo horário deve preceder consulta', () => {
  assert.deepEqual(
    utc('2026-10-06T10:00:00Z', {
      offsetMinutes: 60,
      minimumTimeBeforeAppointment: 120,
    }),
    skipped('MINIMUM_TIME_BEFORE_APPOINTMENT'),
  );
  assert.deepEqual(
    utc('2026-10-06T10:00:00Z', {
      offsetMinutes: 120,
      minimumTimeBeforeAppointment: 120,
    }),
    schedule('2026-10-06T08:00:00.000Z'),
  );
  assert.deepEqual(
    utc('2026-10-06T09:00:00Z', {
      offsetMinutes: 300,
      outsideWindowPolicy: 'NEXT_ALLOWED_TIME',
      minimumTimeBeforeAppointment: 120,
    }),
    skipped('MINIMUM_TIME_BEFORE_APPOINTMENT'),
  );
});
test('retry19+4h não envia23: NEXT terça08, PREVIOUS20; limite total de tentativas', () => {
  const previous = date('2026-10-05T19:00:00Z'),
    appt = date('2026-10-06T12:00:00Z');
  assert.deepEqual(
    retry(
      previous,
      appt,
      'UTC',
      { ...base, outsideWindowPolicy: 'NEXT_ALLOWED_TIME' },
      2,
    ),
    schedule('2026-10-06T08:00:00.000Z'),
  );
  assert.deepEqual(
    retry(previous, appt, 'UTC', base, 2),
    schedule('2026-10-05T20:00:00.000Z'),
  );
  assert.deepEqual(
    retry(previous, appt, 'UTC', base, 3),
    skipped('MAX_ATTEMPTS'),
  );
  assert.deepEqual(
    retry(previous, appt, 'UTC', { ...base, maxAttempts: 1 }, 2),
    skipped('MAX_ATTEMPTS'),
  );
  assert.deepEqual(
    retry(previous, appt, 'UTC', { ...base, retryEnabled: false }, 2),
    skipped('RETRY_DISABLED'),
  );
  assert.deepEqual(
    retry(previous, appt, 'UTC', base, 1),
    skipped('INVALID_INPUT'),
  );
});
test('retry aplica dias, mínimo e cronologia; PREVIOUS não repete tentativa anterior', () => {
  const rule = {
    ...base,
    outsideWindowPolicy: 'NEXT_ALLOWED_TIME' as const,
    allowedWeekdays: weekdays.filter((x) => x !== 'SUNDAY'),
  };
  assert.deepEqual(
    retry(
      date('2026-10-03T19:00:00Z'),
      date('2026-10-05T12:00:00Z'),
      'UTC',
      rule,
      2,
    ),
    schedule('2026-10-05T08:00:00.000Z'),
  );
  assert.deepEqual(
    retry(
      date('2026-10-05T19:00:00Z'),
      date('2026-10-06T07:00:00Z'),
      'UTC',
      rule,
      2,
    ),
    skipped('AT_OR_AFTER_APPOINTMENT'),
  );
  assert.deepEqual(
    retry(
      date('2026-10-05T19:00:00Z'),
      date('2026-10-06T09:00:00Z'),
      'UTC',
      { ...rule, minimumTimeBeforeAppointment: 120 },
      2,
    ),
    skipped('MINIMUM_TIME_BEFORE_APPOINTMENT'),
  );
  assert.deepEqual(
    retry(
      date('2026-10-05T20:00:00Z'),
      date('2026-10-06T12:00:00Z'),
      'UTC',
      base,
      2,
    ),
    skipped('NON_FORWARD_RETRY'),
  );
});
test('inativa/configuração inválida/dias vazios falham sem loop; regras independentes', () => {
  assert.deepEqual(
    utc('2026-10-06T16:00:00Z', { active: false }),
    skipped('INACTIVE_RULE'),
  );
  assert.deepEqual(
    utc('2026-10-06T16:00:00Z', { allowedWeekdays: [] }),
    skipped('INVALID_RULE'),
  );
  assert.deepEqual(
    utc('2026-10-06T16:00:00Z', {
      allowedWeekdays: [
        'INVALID',
      ] as unknown as NotificationRuleData['allowedWeekdays'],
    }),
    skipped('INVALID_RULE'),
  );
  assert.deepEqual(
    utc('2026-10-06T16:00:00Z', { type: 'REMINDER', offsetMinutes: 60 }),
    schedule('2026-10-06T15:00:00.000Z'),
  );
  assert.deepEqual(
    utc('2026-10-06T16:00:00Z', { actionIfNoResponse: 'CANCEL_APPOINTMENT' }),
    schedule('2026-10-06T12:00:00.000Z'),
  );
});
test('DST gap não inventa02:30; busca outro dia quando toda a janela desaparece', () => {
  const rule = {
    ...base,
    allowedStartTime: localTime('02:30'),
    allowedEndTime: localTime('03:30'),
    offsetMinutes: 180,
    outsideWindowPolicy: 'NEXT_ALLOWED_TIME' as const,
  };
  assert.deepEqual(
    resolve(date('2026-03-08T09:45:00Z'), 'America/New_York', rule),
    schedule('2026-03-08T07:00:00.000Z'),
  );
  const gap = {
    ...rule,
    allowedEndTime: localTime('02:45'),
    offsetMinutes: 1440,
  };
  assert.deepEqual(
    resolve(date('2026-03-09T10:00:00Z'), 'America/New_York', gap),
    schedule('2026-03-09T06:30:00.000Z'),
  );
});
test('DST fold escolhe ocorrência real mais próxima e não usa offset fixo', () => {
  const rule = {
    ...base,
    allowedStartTime: localTime('01:30'),
    allowedEndTime: localTime('01:45'),
    offsetMinutes: 120,
    outsideWindowPolicy: 'NEXT_ALLOWED_TIME' as const,
  };
  assert.deepEqual(
    resolve(date('2026-11-01T08:15:00Z'), 'America/New_York', rule),
    schedule('2026-11-01T06:30:00.000Z'),
  );
  assert.deepEqual(
    resolve(date('2026-11-01T08:15:00Z'), 'America/New_York', {
      ...rule,
      outsideWindowPolicy: 'PREVIOUS_ALLOWED_TIME',
    }),
    schedule('2026-11-01T05:45:00.000Z'),
  );
  assert.deepEqual(
    resolve(date('2026-01-06T13:00:00Z'), 'America/New_York', base),
    schedule('2026-01-06T01:00:00.000Z'),
  );
  assert.deepEqual(
    resolve(date('2026-07-07T12:00:00Z'), 'America/New_York', base),
    schedule('2026-07-07T00:00:00.000Z'),
  );
});
test('timezone fracionado, entrada inválida e timezone ausente não dependem do host', () => {
  assert.deepEqual(
    resolve(date('2026-10-06T02:15:00Z'), 'Asia/Kathmandu', base),
    schedule('2026-10-05T14:15:00.000Z'),
  );
  for (const timezone of ['Invalid/Zone', '', undefined as unknown as string])
    assert.deepEqual(
      resolve(date('2026-10-06T08:00:00Z'), timezone, base),
      skipped('INVALID_INPUT'),
    );
  assert.deepEqual(
    resolve(date('invalid'), 'UTC', base),
    skipped('INVALID_INPUT'),
  );
  assert.deepEqual(
    resolve(date('2026-10-06T08:00:01Z'), 'UTC', base),
    skipped('INVALID_INPUT'),
  );
});
test('DTOs validam criação, patch final, filtros, preview e retry sem campos de tenant/timezone', () => {
  const dto = {
    type: 'CONFIRMATION',
    offsetMinutes: 240,
    allowedStartTime: '08:00',
    allowedEndTime: '20:00',
    allowedWeekdays: [...weekdays],
    outsideWindowPolicy: 'PREVIOUS_ALLOWED_TIME',
  };
  assert.equal(createNotificationDto(dto).actionIfNoResponse, 'NONE');
  assert.equal(createNotificationDto(dto).maxAttempts, 1);
  assert.deepEqual(
    createNotificationDto({
      ...dto,
      allowedWeekdays: ['TUESDAY', 'MONDAY', 'TUESDAY'],
    }).allowedWeekdays,
    ['MONDAY', 'TUESDAY'],
  );
  for (const patch of [
    { offsetMinutes: -1 },
    { offsetMinutes: 1.5 },
    { allowedStartTime: '20:00' },
    { allowedEndTime: '07:00' },
    { allowedWeekdays: [] },
    { retryEnabled: true },
    { retryEnabled: true, retryAfterMinutes: 0 },
    { retryEnabled: true, retryAfterMinutes: -1 },
    { maxAttempts: 0 },
    { minimumTimeBeforeAppointment: -1 },
    { tenantId: randomUUID() },
    { active: 'true' },
    { type: 'EMAIL' },
    { allowedStartTime: '08:00:10' },
  ])
    assert.throws(() => createNotificationDto({ ...dto, ...patch }));
  assert.throws(() =>
    validateNotificationRule({
      ...createNotificationDto(dto),
      ...updateNotificationDto({ allowedStartTime: '21:00' }),
    }),
  );
  assert.throws(() => updateNotificationDto({}));
  assert.throws(() => notificationFilter({ active: 'yes' }));
  assert.throws(() => notificationFilter({ tenantId: randomUUID() }));
  assert.deepEqual(notificationFilter({ type: 'REMINDER', active: 'false' }), {
    type: 'REMINDER',
    active: false,
  });
  assert.throws(() =>
    previewDto({ appointmentStart: '2026-10-06T11:00:00Z', timezone: 'UTC' }),
  );
  assert.throws(() =>
    previewDto({
      appointmentStart: '2026-10-06T11:00:00Z',
      previousAttemptAt: '2026-10-05T11:00:00Z',
    }),
  );
  assert.throws(() =>
    resolutionDto({ appointmentId: randomUUID(), attemptNumber: 2 }),
  );
});
