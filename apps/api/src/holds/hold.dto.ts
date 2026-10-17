import { BadRequestException } from '@nestjs/common';
import { fields } from '../configuration/dto';
import { uuid, civilDate } from '../availability/availability.dto';
export interface CreateHoldDto {
  requestId: string;
  patientId: string;
  contactId: string | null;
  serviceId: string;
  providerId: string;
  unitId: string;
  startAt: Date;
  endAt?: Date;
}
export function instant(value: unknown): Date {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(
      value,
    )
  )
    throw new BadRequestException(
      'Informe instante com offset e precisão de minuto.',
    );
  civilDate(value.slice(0, 10));
  if (
    Number(value.slice(11, 13)) > 23 ||
    Number(value.slice(14, 16)) > 59 ||
    /[+-]14:(?!00)/.test(value)
  )
    throw new BadRequestException('Instante inválido.');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new BadRequestException('Instante inválido.');
  return date;
}
export function createHoldDto(body: unknown): CreateHoldDto {
  const input = fields(body, [
    'requestId',
    'patientId',
    'contactId',
    'serviceId',
    'providerId',
    'unitId',
    'startAt',
    'endAt',
  ]);
  const dto = {
    requestId: uuid(input.requestId),
    patientId: uuid(input.patientId),
    contactId: input.contactId == null ? null : uuid(input.contactId),
    serviceId: uuid(input.serviceId),
    providerId: uuid(input.providerId),
    unitId: uuid(input.unitId),
    startAt: instant(input.startAt),
    ...('endAt' in input ? { endAt: instant(input.endAt) } : {}),
  };
  if (dto.endAt && dto.endAt <= dto.startAt)
    throw new BadRequestException('Início deve anteceder o fim.');
  return dto;
}
export function activeHoldsQuery(query: unknown) {
  const input = fields(query, ['providerId', 'unitId', 'startAt', 'endAt']);
  const result = {
    providerId: uuid(input.providerId),
    unitId: uuid(input.unitId),
    startAt: instant(input.startAt),
    endAt: instant(input.endAt),
  };
  if (
    result.endAt <= result.startAt ||
    +result.endAt - +result.startAt > 31 * 86400000
  )
    throw new BadRequestException('Intervalo deve ter até 31 dias.');
  return result;
}
