import { BadRequestException } from '@nestjs/common';
import { fields } from '../configuration/dto';
import { uuid } from '../availability/availability.dto';
import { instant } from '../holds/hold.dto';
import { states, type AppointmentState } from './appointment.state';
export function optionalText(value: unknown, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== 'string' || value.trim().length > max)
    throw new BadRequestException('Texto inválido.');
  return value.trim() || null;
}
function metadata(input: Record<string, unknown>) {
  const source = input.source ?? 'MANUAL';
  if (source !== 'MANUAL' && source !== 'WEB' && source !== 'PHONE')
    throw new BadRequestException('Origem inválida para operação humana.');
  return {
    source: source as 'MANUAL' | 'WEB' | 'PHONE',
    notes: optionalText(input.notes, 2000),
  };
}
const slotKeys = ['serviceId', 'providerId', 'unitId', 'startAt', 'endAt'];
function slot(input: Record<string, unknown>) {
  const startAt = instant(input.startAt),
    endAt = input.endAt === undefined ? undefined : instant(input.endAt);
  if (endAt && endAt <= startAt)
    throw new BadRequestException('Início deve anteceder o fim.');
  return {
    serviceId: uuid(input.serviceId),
    providerId: uuid(input.providerId),
    unitId: uuid(input.unitId),
    startAt,
    ...(endAt ? { endAt } : {}),
  };
}
export function appointmentDto(body: unknown) {
  const input = fields(body, [
    ...slotKeys,
    'patientId',
    'contactId',
    'source',
    'notes',
  ]);
  return {
    ...slot(input),
    patientId: uuid(input.patientId),
    contactId: input.contactId == null ? null : uuid(input.contactId),
    ...metadata(input),
  };
}
export function conversionDto(body: unknown) {
  const input = fields(body, ['holdId', 'source', 'notes']);
  return { holdId: uuid(input.holdId), ...metadata(input) };
}
export function rescheduleDto(body: unknown) {
  const input = fields(body, [...slotKeys, 'source', 'notes']);
  return { ...slot(input), ...metadata(input) };
}
export function cancellationDto(body: unknown) {
  if (
    body == null ||
    (typeof body === 'object' &&
      !Array.isArray(body) &&
      Object.keys(body).length === 0)
  )
    return { reason: null };
  return { reason: optionalText(fields(body ?? {}, ['reason']).reason, 1000) };
}
export function statusDto(body: unknown) {
  const input = fields(body, ['status']);
  if (
    !['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW'].includes(
      String(input.status),
    )
  )
    throw new BadRequestException('Estado inválido.');
  return input.status as AppointmentState;
}
export function appointmentsQuery(query: unknown) {
  const input = fields(query, [
    'startAt',
    'endAt',
    'providerId',
    'unitId',
    'patientId',
    'status',
  ]);
  const startAt = instant(input.startAt),
    endAt = instant(input.endAt);
  if (endAt <= startAt || +endAt - +startAt > 31 * 86400000)
    throw new BadRequestException('Intervalo deve ter até 31 dias.');
  if (
    input.status !== undefined &&
    !states.includes(input.status as AppointmentState)
  )
    throw new BadRequestException('Estado inválido.');
  return {
    startAt,
    endAt,
    ...(input.providerId !== undefined
      ? { providerId: uuid(input.providerId) }
      : {}),
    ...(input.unitId !== undefined ? { unitId: uuid(input.unitId) } : {}),
    ...(input.patientId !== undefined
      ? { patientId: uuid(input.patientId) }
      : {}),
    ...(input.status !== undefined
      ? { status: input.status as AppointmentState }
      : {}),
  };
}
