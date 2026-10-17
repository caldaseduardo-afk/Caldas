import type { AppointmentMetrics } from '@atendente/types';
import type { DashboardQuery } from './analytics.dto';
export function addDays(date: string, count: number) {
  return new Date(Date.parse(date + 'T12:00:00Z') + count * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function civilToday(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function civilPeriod(
  query: DashboardQuery,
  now: Date,
  timezone: string,
) {
  const today = civilToday(now, timezone),
    month = today.slice(0, 7) + '-01';
  switch (query.period) {
    case 'CUSTOM':
      return { from: query.from!, to: query.to! };
    case 'TODAY':
      return { from: today, to: today };
    case 'LAST_7_DAYS':
      return { from: addDays(today, -6), to: today };
    case 'THIS_MONTH':
      return {
        from: month,
        to: addDays(addDays(month, 32).slice(0, 7) + '-01', -1),
      };
    case 'LAST_MONTH':
      return {
        from: addDays(month, -1).slice(0, 7) + '-01',
        to: addDays(month, -1),
      };
    default:
      return { from: addDays(today, -29), to: today };
  }
}
export const rate = (n: number, d: number) =>
  d > 0 ? Math.round((10000 * n) / d) / 100 : 0;
export interface AppointmentGroup {
  date: string;
  status: string;
  source: string;
  count: number;
  past: number;
}
export function appointmentMetrics(
  rows: AppointmentGroup[],
): AppointmentMetrics {
  const count = (statuses?: string[]) =>
    rows.reduce(
      (n, r) => n + (!statuses || statuses.includes(r.status) ? r.count : 0),
      0,
    );
  const total = count(),
    cancelled = count(['CANCELLED']),
    confirmed = count(['CONFIRMED', 'CHECKED_IN', 'COMPLETED']);
  const noShow = count(['NO_SHOW']);
  const noShowEligible = rows.reduce(
    (n, r) => n + (['COMPLETED', 'NO_SHOW'].includes(r.status) ? r.past : 0),
    0,
  );
  const pastNoShow = rows.reduce(
    (n, r) => n + (r.status === 'NO_SHOW' ? r.past : 0),
    0,
  );
  return {
    total,
    confirmed,
    cancelled,
    noShow,
    confirmationEligible: total - cancelled,
    noShowEligible,
    confirmationRate: rate(confirmed, total - cancelled),
    cancellationRate: rate(cancelled, total),
    noShowRate: rate(pastNoShow, noShowEligible),
  };
}
