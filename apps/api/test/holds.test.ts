import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createHoldDto,
  instant,
  activeHoldsQuery,
} from '../src/holds/hold.dto';
import { holdTtlSeconds } from '../src/holds/hold.config';
import {
  fitsStructuralWindows,
  localClock,
  overlaps,
} from '../src/holds/scheduling-conflict';
const id = '00000000-0000-4000-8000-000000000001';
const base = {
  requestId: id,
  patientId: id,
  providerId: id,
  serviceId: id,
  unitId: id,
  startAt: '2035-01-01T14:00:00-03:00',
};
test('HOLD: DTO estrito, instantes com offset, endAt opcional e TTL configurável', () => {
  assert.equal(
    createHoldDto(base).startAt.toISOString(),
    '2035-01-01T17:00:00.000Z',
  );
  assert.equal(createHoldDto(base).contactId, null);
  for (const invalid of [
    { endAt: base.startAt },
    { endAt: '2035-01-01T13:00:00-03:00' },
    { tenantId: id },
    { expiresAt: base.startAt },
    { status: 'ACTIVE' },
    { conversationId: id },
    { requestId: undefined },
  ])
    assert.throws(() => createHoldDto({ ...base, ...invalid }));
  for (const invalid of [
    '2035-01-01T14:00',
    '2035-01-01T14:00:01Z',
    '2035-02-30T14:00:00Z',
    '2035-01-01T24:00:00Z',
    '2035-01-01T14:00:00+14:01',
  ])
    assert.throws(() => instant(invalid));
  assert.equal(holdTtlSeconds(undefined), 300);
  assert.equal(holdTtlSeconds('90'), 90);
  for (const value of ['0', '-1', '1.5', 'NaN', '86401'])
    assert.throws(() => holdTtlSeconds(value));
  assert.throws(() =>
    activeHoldsQuery({
      providerId: id,
      unitId: id,
      startAt: '2035-01-01T00:00:00Z',
      endAt: '2035-03-01T00:00:00Z',
    }),
  );
});
test('conflito usa intervalos semiabertos e detecta sobreposição parcial', () => {
  const at = (time: string) => instant(`2035-01-01T${time}:00Z`);
  const a = { start: at('14:00'), end: at('14:50') };
  assert.equal(overlaps(a, { start: at('14:30'), end: at('15:10') }), true);
  assert.equal(overlaps(a, { start: at('14:50'), end: at('15:30') }), false);
});
test('UTC/timezone e DST: offsets distinguem fold; gap não inventa instantes', () => {
  assert.deepEqual(
    localClock(instant('2035-01-01T02:00:00Z'), 'America/Sao_Paulo'),
    { date: '2034-12-31', time: '23:00' },
  );
  const zone = 'America/New_York';
  const windows = [{ start: '01:00', end: '04:00' }];
  assert.equal(
    fitsStructuralWindows(
      instant('2026-03-08T01:30:00-05:00'),
      instant('2026-03-08T03:30:00-04:00'),
      zone,
      windows,
    ),
    true,
  );
  assert.equal(
    fitsStructuralWindows(
      instant('2026-03-08T01:30:00-05:00'),
      instant('2026-03-08T03:30:00-04:00'),
      zone,
      [{ start: '01:00', end: '03:00' }],
    ),
    false,
  );
  for (const [start, end] of [
    ['2026-11-01T01:00:00-04:00', '2026-11-01T01:00:00-05:00'],
    ['2026-11-01T01:00:00-05:00', '2026-11-01T02:00:00-05:00'],
  ])
    assert.equal(
      fitsStructuralWindows(instant(start), instant(end), zone, [
        { start: '01:00', end: '02:00' },
      ]),
      true,
    );
  assert.equal(
    fitsStructuralWindows(
      instant('2035-01-01T23:00:00Z'),
      instant('2035-01-02T01:00:00Z'),
      'UTC',
      [{ start: '00:00', end: '23:59' }],
    ),
    false,
  );
  assert.equal(
    fitsStructuralWindows(
      instant('2035-01-01T00:00:00Z'),
      instant('2035-01-03T00:00:00Z'),
      'UTC',
      windows,
    ),
    false,
  );
});
