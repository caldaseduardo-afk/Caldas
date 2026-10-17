import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { structuralWindows } from '../src/availability/availability.windows';
import {
  civilDate,
  localTime,
  timeText,
  dateText,
  weekdayOf,
  createRuleDto,
  updateRuleDto,
  validateRule,
  createExceptionDto,
  updateExceptionDto,
  validateException,
  availabilityFilter,
} from '../src/availability/availability.dto';
const id = '00000000-0000-4000-8000-000000000001';
const base = {
  providerId: id,
  unitId: id,
  weekday: 'MONDAY',
  startTime: '08:00',
  endTime: '12:00',
  validFrom: '2026-10-01',
};
const ex = { providerId: id, unitId: id, type: 'BLOCK', date: '2026-10-19' };
test('calendário civil e TIME não dependem do timezone do host, inclusive datas DST', () => {
  const previous = process.env.TZ;
  try {
    for (const tz of [
      'UTC',
      'America/Sao_Paulo',
      'America/New_York',
      'Pacific/Kiritimati',
      'Pacific/Honolulu',
    ]) {
      process.env.TZ = tz;
      assert.equal(weekdayOf(civilDate('2026-10-19')), 'MONDAY');
      assert.equal(weekdayOf(civilDate('2026-03-08')), 'SUNDAY');
      assert.equal(weekdayOf(civilDate('2026-11-01')), 'SUNDAY');
      assert.equal(dateText(civilDate('2026-03-08')), '2026-03-08');
      assert.equal(timeText(localTime('02:30')), '02:30');
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
  for (const day of [
    '2026-02-29',
    '2026-10-01T03:00:00Z',
    '0000-01-01',
    '2026-13-01',
    '15/10/2026',
  ])
    assert.throws(() => civilDate(day), BadRequestException);
  for (const time of ['24:00', '08:00Z', '8:00', '08:00:30', '10:60', null])
    assert.throws(() => localTime(time), BadRequestException);
});
test('regras/exceções validam payload e estado final de PATCH; EXTRA exige período', () => {
  assert.equal(createRuleDto(base).active, true);
  for (const patch of [
    { startTime: '12:00' },
    { endTime: '07:59' },
    { validUntil: '2026-09-30' },
  ])
    assert.throws(
      () => createRuleDto({ ...base, ...patch }),
      BadRequestException,
    );
  const rule = createRuleDto(base);
  assert.throws(
    () => validateRule({ ...rule, ...updateRuleDto({ startTime: '13:00' }) }),
    BadRequestException,
  );
  assert.equal(createExceptionDto(ex).startTime, null);
  for (const patch of [
    { startTime: '10:00' },
    { type: 'EXTRA_AVAILABILITY' },
    { startTime: '11:00', endTime: '10:00' },
  ])
    assert.throws(
      () => createExceptionDto({ ...ex, ...patch }),
      BadRequestException,
    );
  assert.throws(
    () =>
      validateException({
        ...createExceptionDto(ex),
        ...updateExceptionDto({ startTime: '10:00' }),
      }),
    BadRequestException,
  );
  for (const body of [
    { tenantId: id },
    { providerId: id },
    { unitId: id },
    { active: 'false' },
    {},
  ]) {
    assert.throws(() => updateRuleDto(body));
    assert.throws(() => updateExceptionDto(body));
  }
  assert.deepEqual(availabilityFilter({}), {});
  assert.throws(() =>
    availabilityFilter(
      { dateFrom: '2026-10-20', dateUntil: '2026-10-19' },
      true,
    ),
  );
  assert.throws(() => availabilityFilter({ active: ['true'] }));
  assert.throws(() => availabilityFilter({ tenantId: id }));
});
test('BLOCK divide janelas; bloqueios sobrepostos, adjacência e precedência sobre extras', () => {
  const rules = [
    { start: '08:00', end: '12:00' },
    { start: '14:00', end: '18:00' },
  ];
  assert.deepEqual(
    structuralWindows(rules, [
      { type: 'MEETING', startTime: '10:00', endTime: '11:00' },
    ]),
    [
      { start: '08:00', end: '10:00' },
      { start: '11:00', end: '12:00' },
      { start: '14:00', end: '18:00' },
    ],
  );
  const extra = [
    { type: 'EXTRA_AVAILABILITY', startTime: '18:00', endTime: '19:00' },
    { type: 'EXTRA_AVAILABILITY', startTime: '19:00', endTime: '20:00' },
  ];
  assert.deepEqual(structuralWindows([], extra), [
    { start: '18:00', end: '20:00' },
  ]);
  assert.deepEqual(
    structuralWindows(
      [],
      [...extra, { type: 'BLOCK', startTime: '18:30', endTime: '19:30' }],
    ),
    [
      { start: '18:00', end: '18:30' },
      { start: '19:30', end: '20:00' },
    ],
  );
  for (const type of ['VACATION', 'HOLIDAY', 'BLOCK', 'MEETING', 'OTHER'])
    assert.deepEqual(
      structuralWindows(rules, [
        ...extra,
        { type, startTime: null, endTime: null },
      ]),
      [],
    );
  assert.deepEqual(
    structuralWindows(rules, [
      { type: 'BLOCK', startTime: '12:00', endTime: '14:00' },
    ]),
    rules,
  );
  assert.deepEqual(
    structuralWindows(rules, [
      { type: 'BLOCK', startTime: '09:00', endTime: '15:00' },
      { type: 'OTHER', startTime: '10:00', endTime: '16:00' },
    ]),
    [
      { start: '08:00', end: '09:00' },
      { start: '16:00', end: '18:00' },
    ],
  );
});
test('união/subtração confere com cobertura minuto a minuto e independe da ordem', () => {
  const clock = (v: number) =>
    `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
  for (let seed = 1; seed <= 24; seed++) {
    const ranges = Array.from({ length: 6 }, (_, i) => {
      const start = (seed * 41 + i * 173) % 1200;
      return { start, end: start + 90 + i * 11 };
    });
    const rules = ranges
      .slice(0, 2)
      .map((r) => ({ start: clock(r.start), end: clock(r.end) }));
    const exceptions = ranges.slice(2).map((r, i) => ({
      type: i < 2 ? 'EXTRA_AVAILABILITY' : 'BLOCK',
      startTime: clock(r.start),
      endTime: clock(r.end),
    }));
    const result = structuralWindows(rules, exceptions);
    assert.deepEqual(
      structuralWindows([...rules].reverse(), [...exceptions].reverse()),
      result,
    );
    for (let m = 0; m < 1440; m++) {
      const expected =
        ranges.slice(0, 4).some((r) => r.start <= m && m < r.end) &&
        !ranges.slice(4).some((r) => r.start <= m && m < r.end);
      const actual = result.some(
        (r) => r.start <= clock(m) && clock(m) < r.end,
      );
      assert.equal(actual, expected);
    }
  }
});
