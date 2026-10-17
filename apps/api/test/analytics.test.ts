import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dashboardQuery, optionsQuery } from '../src/analytics/analytics.dto';
import {
  appointmentMetrics,
  civilPeriod,
  rate,
} from '../src/analytics/analytics.metrics';
import { AnalyticsService } from '../src/analytics/analytics.service';
import type {
  AnalyticsRepository,
  DashboardAggregates,
} from '../src/analytics/analytics.repository';
import type { AuthorizationService } from '../src/permissions/authorization.service';
test('Dashboard: DTO estrito, datas civis reais, range e paginação limitados', () => {
  for (const raw of [
    { tenantId: 'evil' },
    { period: 'CUSTOM' },
    { period: 'CUSTOM', from: '2026-02-30', to: '2026-03-01' },
    { period: 'CUSTOM', from: '2026-02-01', to: '2026-01-01' },
    { period: 'CUSTOM', from: '2025-01-01', to: '2026-01-02' },
    { from: '2026-01-01' },
    { unitId: "' OR 1=1" },
  ])
    assert.throws(() => dashboardQuery(raw));
  assert.equal(
    dashboardQuery({ period: 'CUSTOM', from: '2024-01-01', to: '2024-12-31' })
      .period,
    'CUSTOM',
  );
  assert.throws(() => optionsQuery({ kind: 'unit', page: 0 }));
  assert.throws(() => optionsQuery({ kind: 'unit', tenantId: 'x' }));
  assert.equal(optionsQuery({ kind: 'service' }).page, 1);
});
test('Dashboard: presets usam timezone, calendário civil, mês e ano bissexto', () => {
  const now = new Date('2026-01-01T01:00:00Z');
  assert.deepEqual(
    civilPeriod(dashboardQuery({ period: 'TODAY' }), now, 'America/Sao_Paulo'),
    { from: '2025-12-31', to: '2025-12-31' },
  );
  assert.deepEqual(
    civilPeriod(dashboardQuery({ period: 'LAST_7_DAYS' }), now, 'UTC'),
    { from: '2025-12-26', to: '2026-01-01' },
  );
  assert.deepEqual(
    civilPeriod(
      dashboardQuery({ period: 'LAST_MONTH' }),
      new Date('2024-03-15Z'),
      'UTC',
    ),
    { from: '2024-02-01', to: '2024-02-29' },
  );
  assert.deepEqual(
    civilPeriod(
      dashboardQuery({ period: 'THIS_MONTH' }),
      new Date('2026-12-15Z'),
      'UTC',
    ),
    { from: '2026-12-01', to: '2026-12-31' },
  );
  assert.deepEqual(civilPeriod(dashboardQuery({}), now, 'UTC'), {
    from: '2025-12-03',
    to: '2026-01-01',
  });
});
test('Dashboard: fórmulas explícitas, finais, futuro e denominador zero', () => {
  const rows = [
    ['CONFIRMED', 6, 0],
    ['CANCELLED', 2, 2],
    ['NO_SHOW', 1, 1],
  ] as const;
  const metrics = appointmentMetrics(
    rows.map(([status, count, past]) => ({
      date: '2026-01-15',
      source: 'MANUAL',
      status,
      count,
      past,
    })),
  );
  assert.equal(metrics.total, 9);
  assert.equal(metrics.confirmationRate, 85.71);
  assert.equal(metrics.cancellationRate, 22.22);
  assert.equal(metrics.noShowRate, 100);
  assert.equal(
    appointmentMetrics([
      { date: 'x', source: 'WEB', status: 'NO_SHOW', count: 1, past: 0 },
    ]).noShowRate,
    0,
  );
  assert.equal(
    appointmentMetrics(
      ['CHECKED_IN', 'COMPLETED'].map((status) => ({
        date: 'x',
        source: 'WEB',
        status,
        count: 1,
        past: 1,
      })),
    ).confirmed,
    2,
  );
  assert.equal(rate(0, 0), 0);
  assert.equal(appointmentMetrics([]).total, 0);
});
test('AnalyticsService: autorização, séries preenchidas e consistência com resumo', async () => {
  const aggregates = {
    now: new Date('2026-01-16Z'),
    period: {
      from: '2026-01-14',
      to: '2026-01-15',
      startAt: '2026-01-14T00:00:00Z',
      endAt: '2026-01-16T00:00:00Z',
      timezone: 'UTC',
    },
    appointments: [
      {
        date: '2026-01-15',
        status: 'CONFIRMED',
        source: 'WHATSAPP_AI',
        count: 2,
        past: 2,
      },
    ],
    conversationSeries: [],
    conversations: {},
    current: {},
    humanService: {},
    conversion: { started: 2, completed: 1 },
    rankings: [],
  } as unknown as DashboardAggregates;
  let permission = '';
  const service = new AnalyticsService(
    {
      requirePermissions: async (p: string) => {
        permission = p;
        return { tenantId: 'a' };
      },
    } as AuthorizationService,
    { aggregate: async () => aggregates } as unknown as AnalyticsRepository,
  );
  const result = await service.dashboard({});
  assert.equal(permission, 'analytics.view');
  assert.equal(result.appointmentSeries.length, 2);
  assert.equal(result.appointmentSeries[0].total, 0);
  assert.equal(
    result.appointmentSeries.reduce((n, r) => n + r.total, 0),
    result.appointments.total,
  );
  assert.equal(result.conversion.rate, 50);
});
