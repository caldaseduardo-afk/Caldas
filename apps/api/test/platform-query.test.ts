import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  platformQuery,
  platformTenantId,
} from '../src/platform-admin/platform.dto';
import { civilPeriod } from '../src/analytics/analytics.metrics';

test('plataforma: parâmetros são limitados e não autorizam escopo', () => {
  for (const invalid of [
    { tenantId: 'arbitrary' },
    { platformScope: 'true' },
    { limit: '101' },
    { page: '0' },
    { activeInPeriod: '1' },
    { period: 'CUSTOM', from: '2026-02-30', to: '2026-03-01' },
    { period: 'CUSTOM', from: '2025-01-01', to: '2026-01-02' },
  ])
    assert.throws(() => platformQuery(invalid));
  assert.equal(platformQuery({}).limit, 25);
  assert.equal(
    platformQuery({ limit: '100', page: '2', status: 'SUSPENDED' }).page,
    2,
  );
  assert.throws(() => platformTenantId("' OR 1=1 --"));
});

test('plataforma: hoje global UTC difere do hoje da clínica na virada de dia', () => {
  const now = new Date('2026-10-17T01:00:00Z');
  assert.equal(
    civilPeriod(platformQuery({ period: 'TODAY' }), now, 'UTC').from,
    '2026-10-17',
  );
  assert.equal(
    civilPeriod(platformQuery({ period: 'TODAY' }), now, 'America/Sao_Paulo')
      .from,
    '2026-10-16',
  );
});
