import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addCivilDays, dateKeyInTimezone, localMidnightAsUtc, startOfWeek } from '../components/calendar/calendar';

test('agenda constrói semanas civis e converte a meia-noite no timezone da clínica', () => {
  assert.equal(startOfWeek('2026-10-21'), '2026-10-19');
  assert.equal(addCivilDays('2026-10-19', 7), '2026-10-26');
  assert.equal(localMidnightAsUtc('2026-10-19', 'America/Sao_Paulo').toISOString(), '2026-10-19T03:00:00.000Z');
  assert.equal(dateKeyInTimezone(new Date('2026-10-19T02:59:00.000Z'), 'America/Sao_Paulo'), '2026-10-18');
});
