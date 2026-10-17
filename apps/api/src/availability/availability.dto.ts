import { BadRequestException } from '@nestjs/common';
import { fields, textField } from '../configuration/dto';
export const weekdays = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;
export const exceptionTypes = [
  'BLOCK',
  'EXTRA_AVAILABILITY',
  'VACATION',
  'HOLIDAY',
  'MEETING',
  'OTHER',
] as const;
export interface Pair {
  providerId: string;
  unitId: string;
}
export interface RuleData {
  weekday: (typeof weekdays)[number];
  startTime: Date;
  endTime: Date;
  validFrom: Date;
  validUntil: Date | null;
  active: boolean;
}
export interface ExceptionData {
  date: Date;
  startTime: Date | null;
  endTime: Date | null;
  type: (typeof exceptionTypes)[number];
  reason: string | null;
  active: boolean;
}
export function uuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new BadRequestException('Identificador inválido.');
  return value;
}
export function civilDate(value: unknown): Date {
  if (
    typeof value !== 'string' ||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) ||
    value.startsWith('0000')
  )
    throw new BadRequestException('Data inválida.');
  const result = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(result.getTime()) ||
    result.toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException('Data inválida.');
  return result;
}
export function localTime(value: unknown): Date {
  if (
    typeof value !== 'string' ||
    !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)
  )
    throw new BadRequestException('Horário inválido.');
  return new Date(`1970-01-01T${value}:00.000Z`);
}
export const dateText = (date: Date) => date.toISOString().slice(0, 10);
export const timeText = (time: Date) => time.toISOString().slice(11, 16);
export const weekdayOf = (date: Date) => weekdays[(date.getUTCDay() + 6) % 7]!;
const ruleKeys = [
  'weekday',
  'startTime',
  'endTime',
  'validFrom',
  'validUntil',
  'active',
];
const exceptionKeys = [
  'date',
  'startTime',
  'endTime',
  'type',
  'reason',
  'active',
];
function active(input: Record<string, unknown>): { active?: boolean } {
  if (!('active' in input)) return {};
  if (typeof input.active !== 'boolean')
    throw new BadRequestException('Indicador inválido.');
  return { active: input.active };
}
function parseRule(input: Record<string, unknown>): Partial<RuleData> {
  const dto: Partial<RuleData> = active(input);
  if ('weekday' in input) {
    if (!weekdays.includes(input.weekday as RuleData['weekday']))
      throw new BadRequestException('Dia da semana inválido.');
    dto.weekday = input.weekday as RuleData['weekday'];
  }
  if ('startTime' in input) dto.startTime = localTime(input.startTime);
  if ('endTime' in input) dto.endTime = localTime(input.endTime);
  if ('validFrom' in input) dto.validFrom = civilDate(input.validFrom);
  if ('validUntil' in input)
    dto.validUntil =
      input.validUntil === null ? null : civilDate(input.validUntil);
  return dto;
}
export function validateRule(dto: RuleData) {
  if (timeText(dto.startTime) >= timeText(dto.endTime))
    throw new BadRequestException('Início deve anteceder o fim.');
  if (dto.validUntil && dto.validUntil < dto.validFrom)
    throw new BadRequestException('Validade inválida.');
}
export function createRuleDto(body: unknown): RuleData & Pair {
  const input = fields(body, ['providerId', 'unitId', ...ruleKeys]);
  const dto = parseRule(input);
  if (!dto.weekday || !dto.startTime || !dto.endTime || !dto.validFrom)
    throw new BadRequestException(
      'Dia, horários e início da validade obrigatórios.',
    );
  const full = {
    ...dto,
    weekday: dto.weekday,
    startTime: dto.startTime,
    endTime: dto.endTime,
    validFrom: dto.validFrom,
    validUntil: dto.validUntil ?? null,
    active: dto.active ?? true,
    providerId: uuid(input.providerId),
    unitId: uuid(input.unitId),
  };
  validateRule(full);
  return full;
}
export function updateRuleDto(body: unknown) {
  return parseRule(fields(body, ruleKeys));
}
function parseException(
  input: Record<string, unknown>,
): Partial<ExceptionData> {
  const dto: Partial<ExceptionData> = active(input);
  if ('date' in input) dto.date = civilDate(input.date);
  if ('type' in input) {
    if (!exceptionTypes.includes(input.type as ExceptionData['type']))
      throw new BadRequestException('Tipo inválido.');
    dto.type = input.type as ExceptionData['type'];
  }
  for (const key of ['startTime', 'endTime'] as const)
    if (key in input)
      dto[key] = input[key] === null ? null : localTime(input[key]);
  if ('reason' in input)
    dto.reason = input.reason === null ? null : textField(input.reason, 2000);
  return dto;
}
export function validateException(dto: ExceptionData) {
  if ((dto.startTime === null) !== (dto.endTime === null))
    throw new BadRequestException('Informe ambos os horários ou nenhum.');
  if (
    dto.startTime &&
    dto.endTime &&
    timeText(dto.startTime) >= timeText(dto.endTime)
  )
    throw new BadRequestException('Início deve anteceder o fim.');
  if (dto.type === 'EXTRA_AVAILABILITY' && !dto.startTime)
    throw new BadRequestException('Disponibilidade extra exige horários.');
}
export function createExceptionDto(body: unknown): ExceptionData & Pair {
  const input = fields(body, ['providerId', 'unitId', ...exceptionKeys]);
  const dto = parseException(input);
  if (!dto.date || !dto.type)
    throw new BadRequestException('Data e tipo obrigatórios.');
  const full = {
    ...dto,
    date: dto.date,
    type: dto.type,
    startTime: dto.startTime ?? null,
    endTime: dto.endTime ?? null,
    reason: dto.reason ?? null,
    active: dto.active ?? true,
    providerId: uuid(input.providerId),
    unitId: uuid(input.unitId),
  };
  validateException(full);
  return full;
}
export function updateExceptionDto(body: unknown) {
  return parseException(fields(body, exceptionKeys));
}
export interface AvailabilityFilter {
  providerId?: string;
  unitId?: string;
  active?: boolean;
  dateFrom?: Date;
  dateUntil?: Date;
}
export function availabilityFilter(
  query: unknown,
  exceptions = false,
): AvailabilityFilter {
  if (!query || typeof query !== 'object' || Array.isArray(query))
    throw new BadRequestException('Filtros inválidos.');
  if (!Object.keys(query).length) return {};
  const input = fields(query, [
    'providerId',
    'unitId',
    'active',
    ...(exceptions ? ['dateFrom', 'dateUntil'] : []),
  ]);
  const dto: AvailabilityFilter = {};
  for (const key of ['providerId', 'unitId'] as const)
    if (key in input) dto[key] = uuid(input[key]);
  if ('active' in input) {
    if (input.active !== 'true' && input.active !== 'false')
      throw new BadRequestException('Filtro active inválido.');
    dto.active = input.active === 'true';
  }
  if ('dateFrom' in input) dto.dateFrom = civilDate(input.dateFrom);
  if ('dateUntil' in input) dto.dateUntil = civilDate(input.dateUntil);
  if (dto.dateFrom && dto.dateUntil && dto.dateUntil < dto.dateFrom)
    throw new BadRequestException('Intervalo inválido.');
  return dto;
}
export function structuralQuery(query: unknown) {
  const input = fields(query, ['unitId', 'date']);
  return { unitId: uuid(input.unitId), date: civilDate(input.date) };
}
