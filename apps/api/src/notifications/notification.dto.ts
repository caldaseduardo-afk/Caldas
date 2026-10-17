import { BadRequestException } from '@nestjs/common';
import { fields } from '../configuration/dto';
import { localTime, uuid, weekdays } from '../availability/availability.dto';
import { instant } from '../holds/hold.dto';
import {
  notificationTypes,
  outsidePolicies,
  noResponseActions,
  validInteger,
  validNotificationRule,
  type NotificationRuleData,
} from './notification.schedule';
const keys = [
  'type',
  'offsetMinutes',
  'allowedStartTime',
  'allowedEndTime',
  'allowedWeekdays',
  'outsideWindowPolicy',
  'retryEnabled',
  'retryAfterMinutes',
  'maxAttempts',
  'minimumTimeBeforeAppointment',
  'actionIfNoResponse',
  'active',
];
function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T))
    throw new BadRequestException('Opção inválida.');
  return value as T;
}
function parse(input: Record<string, unknown>): Partial<NotificationRuleData> {
  const dto: Partial<NotificationRuleData> = {};
  if ('type' in input) dto.type = enumValue(input.type, notificationTypes);
  if ('outsideWindowPolicy' in input)
    dto.outsideWindowPolicy = enumValue(
      input.outsideWindowPolicy,
      outsidePolicies,
    );
  if ('actionIfNoResponse' in input)
    dto.actionIfNoResponse = enumValue(
      input.actionIfNoResponse,
      noResponseActions,
    );
  for (const key of [
    'offsetMinutes',
    'maxAttempts',
    'minimumTimeBeforeAppointment',
  ] as const)
    if (key in input) {
      if (!validInteger(input[key], key === 'maxAttempts' ? 1 : 0))
        throw new BadRequestException('Inteiro inválido.');
      dto[key] = input[key];
    }
  if ('retryAfterMinutes' in input) {
    if (
      input.retryAfterMinutes !== null &&
      !validInteger(input.retryAfterMinutes, 1)
    )
      throw new BadRequestException('Retry inválido.');
    dto.retryAfterMinutes = input.retryAfterMinutes;
  }
  for (const key of ['allowedStartTime', 'allowedEndTime'] as const)
    if (key in input) dto[key] = localTime(input[key]);
  for (const key of ['retryEnabled', 'active'] as const)
    if (key in input) {
      if (typeof input[key] !== 'boolean')
        throw new BadRequestException('Indicador inválido.');
      dto[key] = input[key];
    }
  if ('allowedWeekdays' in input) {
    if (
      !Array.isArray(input.allowedWeekdays) ||
      input.allowedWeekdays.length < 1 ||
      input.allowedWeekdays.length > 7 ||
      input.allowedWeekdays.some((day) => !weekdays.includes(day))
    )
      throw new BadRequestException('Dias inválidos.');
    dto.allowedWeekdays = weekdays.filter((day) =>
      (input.allowedWeekdays as unknown[]).includes(day),
    );
  }
  return dto;
}
export function validateNotificationRule(dto: NotificationRuleData) {
  if (!validNotificationRule(dto))
    throw new BadRequestException('Configuração de notificação inválida.');
}
export function createNotificationDto(body: unknown): NotificationRuleData {
  const dto = parse(fields(body, keys));
  if (
    dto.type === undefined ||
    dto.offsetMinutes === undefined ||
    !dto.allowedStartTime ||
    !dto.allowedEndTime ||
    !dto.allowedWeekdays ||
    !dto.outsideWindowPolicy
  )
    throw new BadRequestException('Campos obrigatórios ausentes.');
  const full = {
    retryEnabled: false,
    retryAfterMinutes: null,
    maxAttempts: 1,
    minimumTimeBeforeAppointment: 0,
    actionIfNoResponse: 'NONE' as const,
    active: true,
    ...dto,
  } as NotificationRuleData;
  validateNotificationRule(full);
  return full;
}
export const updateNotificationDto = (body: unknown) =>
  parse(fields(body, keys));
export function notificationFilter(query: unknown) {
  if (
    query &&
    typeof query === 'object' &&
    !Array.isArray(query) &&
    Object.keys(query).length === 0
  )
    return {};
  const input = fields(query, ['type', 'active']);
  if ('active' in input && input.active !== 'true' && input.active !== 'false')
    throw new BadRequestException('Filtro inválido.');
  return {
    ...('type' in input
      ? { type: enumValue(input.type, notificationTypes) }
      : {}),
    ...('active' in input ? { active: input.active === 'true' } : {}),
  };
}
function retry(input: Record<string, unknown>) {
  if ('previousAttemptAt' in input !== 'attemptNumber' in input)
    throw new BadRequestException('Informe tentativa e horário anterior.');
  if (!('previousAttemptAt' in input)) return {};
  if (!validInteger(input.attemptNumber, 2))
    throw new BadRequestException('Número de tentativa inválido.');
  return {
    previousAttemptAt: instant(input.previousAttemptAt),
    attemptNumber: input.attemptNumber,
  };
}
export const previewDto = (body: unknown) => {
  const input = fields(body, [
    'appointmentStart',
    'unitId',
    'previousAttemptAt',
    'attemptNumber',
  ]);
  return {
    appointmentStart: instant(input.appointmentStart),
    ...('unitId' in input ? { unitId: uuid(input.unitId) } : {}),
    ...retry(input),
  };
};
export const resolutionDto = (body: unknown) => {
  const input = fields(body, [
    'appointmentId',
    'previousAttemptAt',
    'attemptNumber',
  ]);
  return { appointmentId: uuid(input.appointmentId), ...retry(input) };
};
