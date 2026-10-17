export interface Window {
  start: string;
  end: string;
}
interface Interval {
  start: number;
  end: number;
}
const minutes = (text: string) =>
  Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
const clock = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
function union(intervals: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const item of intervals.sort(
    (a, b) => a.start - b.start || a.end - b.end,
  )) {
    const last = result.at(-1);
    if (last && item.start <= last.end) last.end = Math.max(last.end, item.end);
    else result.push({ ...item });
  }
  return result;
}
// Entradas já validadas; relógio local, sem conversão em instantes ou dependência de TZ.
export function structuralWindows(
  rules: Window[],
  exceptions: {
    type: string;
    startTime: string | null;
    endTime: string | null;
  }[],
): Window[] {
  const available = rules.map((w) => ({
    start: minutes(w.start),
    end: minutes(w.end),
  }));
  const blocks: Interval[] = [];
  for (const ex of exceptions) {
    const interval = {
      start: ex.startTime === null ? 0 : minutes(ex.startTime),
      end: ex.endTime === null ? 1440 : minutes(ex.endTime),
    };
    (ex.type === 'EXTRA_AVAILABILITY' ? available : blocks).push(interval);
  }
  let result = union(available);
  for (const block of union(blocks)) {
    result = result.flatMap((w) => {
      if (block.end <= w.start || block.start >= w.end) return [w];
      const parts: Interval[] = [];
      if (w.start < block.start)
        parts.push({ start: w.start, end: block.start });
      if (block.end < w.end) parts.push({ start: block.end, end: w.end });
      return parts;
    });
  }
  return result.map((w) => ({ start: clock(w.start), end: clock(w.end) }));
}
