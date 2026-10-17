import { BadRequestException } from '@nestjs/common';
import { localClock } from '../holds/scheduling-conflict';

export const schedulingPeriods = {
  MORNING: ['06:00', '12:00'],
  AFTERNOON: ['12:00', '18:00'],
  EVENING: ['18:00', '22:00'],
  ANY: ['00:00', '24:00'],
} as const;

export type SchedulingPeriodName = keyof typeof schedulingPeriods;

export function nextCivilDate(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

export function localInstant(
  date: string,
  time: string,
  timezone: string,
): Date {
  const wantedDate = time === '24:00' ? nextCivilDate(date) : date;
  const wantedTime = time === '24:00' ? '00:00' : time;
  const anchor = Date.parse(`${wantedDate}T${wantedTime}:00Z`);
  for (let offset = -14 * 60; offset <= 14 * 60; offset++) {
    const candidate = new Date(anchor + offset * 60000);
    const local = localClock(candidate, timezone);
    if (local.date === wantedDate && local.time === wantedTime)
      return candidate;
  }
  throw new BadRequestException(
    'Horário local inexistente no timezone da unidade.',
  );
}

export function periodRange(
  date: string,
  period: SchedulingPeriodName,
  timezone: string,
) {
  const [start, end] = schedulingPeriods[period];
  return {
    startAt: localInstant(date, start, timezone).toISOString(),
    endAt: localInstant(date, end, timezone).toISOString(),
  };
}

export function isPastCivilDate(date: string, timezone: string, now: Date) {
  return date < localClock(now, timezone).date;
}
