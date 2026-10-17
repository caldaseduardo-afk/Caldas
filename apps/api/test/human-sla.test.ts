import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  humanSlaSchedule,
  resolveHumanSlaLevel,
  humanWaitMinutes,
} from '@atendente/domain';
import { humanSlaDto, previewDate } from '../src/human-sla/human-sla.dto';
import { humanSlaConnection, parseHumanSlaPayload } from '@atendente/database';
import { randomUUID } from 'node:crypto';
const rule = {
  firstAlertMinutes: 5,
  secondAlertMinutes: 10,
  externalAlertMinutes: 15,
  internalAlertEnabled: true,
  externalAlertEnabled: true,
  active: true,
};
test('SLA: fake clock cobre limites exatos, preview e espera sem depender de mensagens', (t) => {
  const requestedAt = new Date('2026-10-04T14:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now: +requestedAt });
  for (const [elapsed, expected] of [
    [-1, 'NONE'],
    [0, 'NONE'],
    [299999, 'NONE'],
    [300000, 'FIRST'],
    [599999, 'FIRST'],
    [600000, 'SECOND'],
    [899999, 'SECOND'],
    [900000, 'EXTERNAL'],
  ] as const) {
    t.mock.timers.setTime(+requestedAt + elapsed);
    assert.equal(resolveHumanSlaLevel(requestedAt, new Date(), rule), expected);
  }
  assert.deepEqual(
    humanSlaSchedule(requestedAt, rule).map((entry) =>
      entry.dueAt.toISOString(),
    ),
    [
      '2026-10-04T14:05:00.000Z',
      '2026-10-04T14:10:00.000Z',
      '2026-10-04T14:15:00.000Z',
    ],
  );
  assert.equal(
    humanWaitMinutes(requestedAt, new Date(+requestedAt + 7 * 60000)),
    7,
  );
  assert.equal(humanWaitMinutes(requestedAt, new Date(+requestedAt - 1)), 0);
});
test('SLA: flags e regra inativa não inventam alertas ou thresholds', () => {
  const start = new Date('2026-10-04T14:00:00Z'),
    late = new Date('2026-10-04T16:00:00Z');
  assert.equal(
    resolveHumanSlaLevel(start, late, { ...rule, active: false }),
    'NONE',
  );
  assert.deepEqual(humanSlaSchedule(start, { ...rule, active: false }), []);
  assert.equal(
    resolveHumanSlaLevel(start, late, {
      ...rule,
      externalAlertEnabled: false,
      externalAlertMinutes: null,
    }),
    'SECOND',
  );
  assert.deepEqual(
    humanSlaSchedule(start, { ...rule, internalAlertEnabled: false }).map(
      (entry) => entry.level,
    ),
    ['EXTERNAL'],
  );
  assert.equal(
    resolveHumanSlaLevel(start, late, {
      ...rule,
      internalAlertEnabled: false,
      externalAlertEnabled: false,
    }),
    'NONE',
  );
});
test('SLA DTO: limites, sequência, flags, campos extras e UTC explícito', () => {
  for (const change of [
    { firstAlertMinutes: 0 },
    { firstAlertMinutes: -1 },
    { firstAlertMinutes: 1.5 },
    { secondAlertMinutes: 5 },
    { externalAlertMinutes: 10 },
    { externalAlertMinutes: null },
    { active: 'true' },
    { tenantId: randomUUID() },
  ])
    assert.throws(() => humanSlaDto({ ...rule, ...change }));
  assert.doesNotThrow(() =>
    humanSlaDto({
      ...rule,
      externalAlertEnabled: false,
      externalAlertMinutes: null,
    }),
  );
  assert.throws(() => humanSlaDto({}));
  assert.throws(() => previewDate({ requestedAt: '2026-10-04T10:00:00' }));
  assert.equal(
    previewDate({ requestedAt: '2026-10-04T11:00:00-03:00' }).toISOString(),
    '2026-10-04T14:00:00.000Z',
  );
});
test('fila SLA: configuração sanitizada e payload mínimo com tenant obrigatório', () => {
  assert.throws(
    () => humanSlaConnection('http://secret:password@localhost/0'),
    { message: 'REDIS_URL inválida ou ausente.' },
  );
  assert.throws(() => humanSlaConnection(undefined));
  const config = humanSlaConnection('rediss://localhost:6380/2');
  assert.equal('db' in config && config.db, 2);
  const payload = { tenantId: randomUUID(), jobId: randomUUID() };
  assert.deepEqual(parseHumanSlaPayload(payload), payload);
  for (const invalid of [
    { ...payload, content: 'sensitive' },
    { jobId: randomUUID() },
    { ...payload, tenantId: 'bad' },
  ])
    assert.throws(() => parseHumanSlaPayload(invalid));
});
