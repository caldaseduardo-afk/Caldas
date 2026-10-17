import { BadRequestException } from '@nestjs/common';
import { fields, textField, moneyField } from '../configuration/dto';
export interface ProviderDto {
  name: string;
  professionalType: string;
  registrationNumber?: string | null;
  active?: boolean;
}
export interface ProviderServiceDto {
  durationOverrideMinutes?: number | null;
  priceOverride?: string | null;
  active?: boolean;
}
export interface ProviderUnitDto {
  active?: boolean;
}
function active(input: Record<string, unknown>): { active?: boolean } {
  if (!('active' in input)) return {};
  if (typeof input.active !== 'boolean')
    throw new BadRequestException('Indicador inválido.');
  return { active: input.active };
}
function uuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new BadRequestException('Identificador inválido.');
  return value;
}
export function updateProviderDto(body: unknown): Partial<ProviderDto> {
  const input = fields(body, [
    'name',
    'professionalType',
    'registrationNumber',
    'active',
  ]);
  const dto: Partial<ProviderDto> = active(input);
  if ('name' in input) dto.name = textField(input.name, 200);
  if ('professionalType' in input)
    dto.professionalType = textField(input.professionalType, 80);
  if ('registrationNumber' in input)
    dto.registrationNumber =
      input.registrationNumber === null
        ? null
        : textField(input.registrationNumber, 120);
  return dto;
}
export function createProviderDto(body: unknown): ProviderDto {
  const dto = updateProviderDto(body);
  if (!dto.name || !dto.professionalType)
    throw new BadRequestException('Nome e tipo profissional obrigatórios.');
  return { ...dto, name: dto.name, professionalType: dto.professionalType };
}
function overrides(input: Record<string, unknown>): ProviderServiceDto {
  const dto: ProviderServiceDto = active(input);
  if ('priceOverride' in input)
    dto.priceOverride = moneyField(input.priceOverride);
  if ('durationOverrideMinutes' in input) {
    const value = input.durationOverrideMinutes;
    if (
      value !== null &&
      (typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > 2147483647)
    )
      throw new BadRequestException('Duração inválida.');
    dto.durationOverrideMinutes = value;
  }
  return dto;
}
const serviceKeys = ['durationOverrideMinutes', 'priceOverride', 'active'];
export function createProviderServiceDto(body: unknown) {
  const input = fields(body, ['serviceId', ...serviceKeys]);
  return { ...overrides(input), serviceId: uuid(input.serviceId) };
}
export function updateProviderServiceDto(body: unknown) {
  return overrides(fields(body, serviceKeys));
}
export function createProviderUnitDto(body: unknown) {
  const input = fields(body, ['unitId', 'active']);
  return { ...active(input), unitId: uuid(input.unitId) };
}
export function updateProviderUnitDto(body: unknown) {
  return active(fields(body, ['active']));
}
export function providerFilter(query: unknown): { active?: boolean } {
  if (!query || typeof query !== 'object' || Array.isArray(query))
    throw new BadRequestException('Filtros inválidos.');
  if (!Object.keys(query).length) return {};
  const input = fields(query, ['active']);
  if (input.active !== 'true' && input.active !== 'false')
    throw new BadRequestException('Filtro active inválido.');
  return { active: input.active === 'true' };
}
