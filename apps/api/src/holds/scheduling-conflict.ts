import type { Window } from '../availability/availability.windows';
export const overlaps = (
  a: { start: Date; end: Date },
  b: { start: Date; end: Date },
) => a.start < b.end && a.end > b.start;
export function localClock(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
}
// Percorre instantes reais: folds são inequívocos pelo offset da entrada; gaps não
// criam instantes. Appointment poderá reutilizar a álgebra de ocupação futuramente.
export function fitsStructuralWindows(
  start: Date,
  end: Date,
  timezone: string,
  windows: Window[],
) {
  if (+end <= +start || +end - +start > 26 * 3600000) return false;
  const day = localClock(start, timezone).date;
  if (localClock(new Date(+end - 1), timezone).date !== day) return false;
  for (let time = +start; time < +end; time += 60000) {
    const local = localClock(new Date(time), timezone);
    if (
      local.date !== day ||
      !windows.some((w) => w.start <= local.time && local.time < w.end)
    )
      return false;
  }
  return true;
}
