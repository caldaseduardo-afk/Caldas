export const humanSlaLevels = ['NONE', 'FIRST', 'SECOND', 'EXTERNAL'] as const;
export type HumanSlaLevel = (typeof humanSlaLevels)[number];
export interface HumanSlaConfig {
  firstAlertMinutes: number;
  secondAlertMinutes: number;
  externalAlertMinutes: number | null;
  internalAlertEnabled: boolean;
  externalAlertEnabled: boolean;
  active: boolean;
}
export function validateHumanSlaRule(rule: HumanSlaConfig) {
  const validMinutes = (n: number) =>
    Number.isInteger(n) && n > 0 && n <= 525600;
  if (
    !validMinutes(rule.firstAlertMinutes) ||
    !validMinutes(rule.secondAlertMinutes) ||
    rule.firstAlertMinutes >= rule.secondAlertMinutes ||
    (rule.externalAlertMinutes !== null &&
      !validMinutes(rule.externalAlertMinutes)) ||
    (rule.externalAlertEnabled &&
      (rule.externalAlertMinutes === null ||
        rule.externalAlertMinutes <= rule.secondAlertMinutes)) ||
    [rule.active, rule.internalAlertEnabled, rule.externalAlertEnabled].some(
      (v) => typeof v !== 'boolean',
    )
  )
    throw new Error('Configuração SLA inválida.');
}
export function humanSlaSchedule(
  requestedAt: Date,
  rule: HumanSlaConfig,
): { level: Exclude<HumanSlaLevel, 'NONE'>; dueAt: Date }[] {
  validateHumanSlaRule(rule);
  if (!Number.isFinite(+requestedAt)) throw new Error('Instante inválido.');
  if (!rule.active) return [];
  const entries: [Exclude<HumanSlaLevel, 'NONE'>, number][] = [];
  if (rule.internalAlertEnabled)
    entries.push(
      ['FIRST', rule.firstAlertMinutes],
      ['SECOND', rule.secondAlertMinutes],
    );
  if (rule.externalAlertEnabled)
    entries.push(['EXTERNAL', rule.externalAlertMinutes!]);
  return entries.map(([level, minutes]) => ({
    level,
    dueAt: new Date(+requestedAt + minutes * 60000),
  }));
}
export function resolveHumanSlaLevel(
  requestedAt: Date,
  now: Date,
  rule: HumanSlaConfig,
): HumanSlaLevel {
  if (!Number.isFinite(+now)) throw new Error('Instante inválido.');
  return (
    humanSlaSchedule(requestedAt, rule)
      .filter((entry) => +entry.dueAt <= +now)
      .at(-1)?.level ?? 'NONE'
  );
}
export function humanWaitMinutes(requestedAt: Date, now: Date) {
  return Math.max(0, Math.floor((+now - +requestedAt) / 60000));
}
