export const notificationWeekdays = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;
export const notificationTypes = ['CONFIRMATION', 'REMINDER'] as const;
export const outsidePolicies = [
  'PREVIOUS_ALLOWED_TIME',
  'NEXT_ALLOWED_TIME',
  'SKIP',
] as const;
export const noResponseActions = [
  'NONE',
  'MARK_UNCONFIRMED',
  'NEEDS_HUMAN',
  'CANCEL_APPOINTMENT',
] as const;

export interface NotificationRuleData {
  type: (typeof notificationTypes)[number];
  offsetMinutes: number;
  allowedStartTime: Date;
  allowedEndTime: Date;
  allowedWeekdays: (typeof notificationWeekdays)[number][];
  outsideWindowPolicy: (typeof outsidePolicies)[number];
  retryEnabled: boolean;
  retryAfterMinutes: number | null;
  maxAttempts: number;
  minimumTimeBeforeAppointment: number;
  actionIfNoResponse: (typeof noResponseActions)[number];
  active: boolean;
}
export type NotificationSkipReason =
  | 'INVALID_RULE'
  | 'INVALID_INPUT'
  | 'INACTIVE_RULE'
  | 'OUTSIDE_ALLOWED_WINDOW'
  | 'NO_ALLOWED_TIME'
  | 'AT_OR_AFTER_APPOINTMENT'
  | 'MINIMUM_TIME_BEFORE_APPOINTMENT'
  | 'RETRY_DISABLED'
  | 'MAX_ATTEMPTS'
  | 'NON_FORWARD_RETRY'
  | 'APPOINTMENT_INACTIVE';
export type NotificationDecision =
  | { decision: 'SCHEDULE'; scheduledAt: string; reason: null }
  | { decision: 'SKIP'; scheduledAt: null; reason: NotificationSkipReason };
export const skipNotification = (
  reason: NotificationSkipReason,
): NotificationDecision => ({ decision: 'SKIP', scheduledAt: null, reason });
export const validInteger = (value: unknown, min = 0): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= min &&
  value <= 2147483647;
const minuteInstant = (date: Date) =>
  date instanceof Date && Number.isFinite(+date) && +date % 60000 === 0;
const clockMinutes = (date: Date) =>
  date.getUTCHours() * 60 + date.getUTCMinutes();
export function validNotificationRule(rule: NotificationRuleData): boolean {
  return (
    !!rule &&
    notificationTypes.includes(rule.type) &&
    validInteger(rule.offsetMinutes) &&
    minuteInstant(rule.allowedStartTime) &&
    minuteInstant(rule.allowedEndTime) &&
    clockMinutes(rule.allowedStartTime) < clockMinutes(rule.allowedEndTime) &&
    Array.isArray(rule.allowedWeekdays) &&
    rule.allowedWeekdays.length >= 1 &&
    rule.allowedWeekdays.length <= 7 &&
    rule.allowedWeekdays.every((day) => notificationWeekdays.includes(day)) &&
    outsidePolicies.includes(rule.outsideWindowPolicy) &&
    typeof rule.retryEnabled === 'boolean' &&
    (rule.retryAfterMinutes === null ||
      validInteger(rule.retryAfterMinutes, 1)) &&
    (!rule.retryEnabled || validInteger(rule.retryAfterMinutes, 1)) &&
    validInteger(rule.maxAttempts, 1) &&
    validInteger(rule.minimumTimeBeforeAppointment) &&
    noResponseActions.includes(rule.actionIfNoResponse) &&
    typeof rule.active === 'boolean'
  );
}
function resolveTarget(
  target: Date,
  appointmentStart: Date,
  timezone: string,
  rule: NotificationRuleData,
): NotificationDecision {
  if (!validNotificationRule(rule)) return skipNotification('INVALID_RULE');
  if (!rule.active) return skipNotification('INACTIVE_RULE');
  if (!minuteInstant(target) || !minuteInstant(appointmentStart))
    return skipNotification('INVALID_INPUT');
  if (
    typeof timezone !== 'string' ||
    (timezone !== 'UTC' && !timezone.includes('/'))
  )
    return skipNotification('INVALID_INPUT');
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    return skipNotification('INVALID_INPUT');
  }
  const names: Record<string, (typeof notificationWeekdays)[number]> = {
    Mon: 'MONDAY',
    Tue: 'TUESDAY',
    Wed: 'WEDNESDAY',
    Thu: 'THURSDAY',
    Fri: 'FRIDAY',
    Sat: 'SATURDAY',
    Sun: 'SUNDAY',
  };
  const allowed = (instant: Date) => {
    const parts = formatter.formatToParts(instant);
    const part = (name: string) => parts.find((p) => p.type === name)?.value;
    const weekday = names[part('weekday') ?? ''];
    const minutes = Number(part('hour')) * 60 + Number(part('minute'));
    return (
      weekday !== undefined &&
      rule.allowedWeekdays.includes(weekday) &&
      part('second') === '00' &&
      minutes >= clockMinutes(rule.allowedStartTime) &&
      minutes <= clockMinutes(rule.allowedEndTime)
    );
  };
  let candidate = target;
  if (!allowed(candidate)) {
    if (rule.outsideWindowPolicy === 'SKIP')
      return skipNotification('OUTSIDE_ALLOWED_WINDOW');
    const step =
      rule.outsideWindowPolicy === 'PREVIOUS_ALLOWED_TIME' ? -60000 : 60000;
    let found = false;
    for (let i = 1; i <= 9 * 1440; i++) {
      candidate = new Date(+target + i * step);
      if (!minuteInstant(candidate)) break;
      if (allowed(candidate)) {
        found = true;
        break;
      }
    }
    if (!found) return skipNotification('NO_ALLOWED_TIME');
  }
  if (candidate >= appointmentStart)
    return skipNotification('AT_OR_AFTER_APPOINTMENT');
  if (
    +appointmentStart - +candidate <
    rule.minimumTimeBeforeAppointment * 60000
  )
    return skipNotification('MINIMUM_TIME_BEFORE_APPOINTMENT');
  return {
    decision: 'SCHEDULE',
    scheduledAt: candidate.toISOString(),
    reason: null,
  };
}
export function resolveNotificationSchedule(
  appointmentStart: Date,
  timezone: string,
  rule: NotificationRuleData,
): NotificationDecision {
  if (!validNotificationRule(rule)) return skipNotification('INVALID_RULE');
  return resolveTarget(
    new Date(+appointmentStart - rule.offsetMinutes * 60000),
    appointmentStart,
    timezone,
    rule,
  );
}
export function resolveRetrySchedule(
  previousAttemptAt: Date,
  appointmentStart: Date,
  timezone: string,
  rule: NotificationRuleData,
  attemptNumber: number,
): NotificationDecision {
  if (!validNotificationRule(rule)) return skipNotification('INVALID_RULE');
  if (!rule.active) return skipNotification('INACTIVE_RULE');
  if (!minuteInstant(previousAttemptAt) || !validInteger(attemptNumber, 2))
    return skipNotification('INVALID_INPUT');
  if (!rule.retryEnabled) return skipNotification('RETRY_DISABLED');
  if (attemptNumber > rule.maxAttempts) return skipNotification('MAX_ATTEMPTS');
  const result = resolveTarget(
    new Date(+previousAttemptAt + rule.retryAfterMinutes! * 60000),
    appointmentStart,
    timezone,
    rule,
  );
  if (
    result.decision === 'SCHEDULE' &&
    Date.parse(result.scheduledAt) <= +previousAttemptAt
  )
    return skipNotification('NON_FORWARD_RETRY');
  return result;
}

/** Revalidates the real execution instant after a delayed worker restart. */
export function resolveNotificationExecution(
  now: Date,
  appointmentStart: Date,
  timezone: string,
  rule: NotificationRuleData,
): NotificationDecision {
  const minute = new Date(Math.floor(+now / 60000) * 60000);
  const result = resolveTarget(minute, appointmentStart, timezone, rule);
  if (
    result.decision === 'SCHEDULE' &&
    Date.parse(result.scheduledAt) < +minute
  )
    return skipNotification('OUTSIDE_ALLOWED_WINDOW');
  return result;
}
