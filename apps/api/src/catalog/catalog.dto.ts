import { BadRequestException } from '@nestjs/common';
import { fields, textField, moneyField } from '../configuration/dto';

export interface SpecialtyDto {
  name: string;
  description?: string | null;
  active?: boolean;
}
export interface ServiceDto extends SpecialtyDto {
  specialtyId: string;
  durationMinutes: number;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  price?: string | null;
}
export interface CatalogFilter {
  active?: boolean;
  specialtyId?: string;
}
const baseKeys = ['name', 'description', 'active'];
const serviceKeys = [
  ...baseKeys,
  'specialtyId',
  'durationMinutes',
  'bufferBeforeMinutes',
  'bufferAfterMinutes',
  'price',
];
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
function base(input: Record<string, unknown>): Partial<SpecialtyDto> {
  const dto: Partial<SpecialtyDto> = {};
  if ('name' in input) dto.name = textField(input.name, 200);
  if ('description' in input)
    dto.description =
      input.description === null ? null : textField(input.description, 2000);
  if ('active' in input) {
    if (typeof input.active !== 'boolean')
      throw new BadRequestException('Indicador inválido.');
    dto.active = input.active;
  }
  return dto;
}
export function updateSpecialtyDto(body: unknown) {
  return base(fields(body, baseKeys));
}
export function createSpecialtyDto(body: unknown): SpecialtyDto {
  const dto = updateSpecialtyDto(body);
  if (!dto.name) throw new BadRequestException('Nome obrigatório.');
  return { ...dto, name: dto.name };
}
export function updateServiceDto(body: unknown): Partial<ServiceDto> {
  const input = fields(body, serviceKeys);
  const dto: Partial<ServiceDto> = base(input);
  if ('specialtyId' in input) dto.specialtyId = uuid(input.specialtyId);
  for (const key of [
    'durationMinutes',
    'bufferBeforeMinutes',
    'bufferAfterMinutes',
  ] as const) {
    if (!(key in input)) continue;
    const value = input[key];
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < (key === 'durationMinutes' ? 1 : 0) ||
      value > 2147483647
    )
      throw new BadRequestException('Minutos inválidos.');
    dto[key] = value;
  }
  if ('price' in input) dto.price = moneyField(input.price);
  return dto;
}
export function createServiceDto(body: unknown): ServiceDto {
  const dto = updateServiceDto(body);
  if (!dto.name || !dto.specialtyId || dto.durationMinutes === undefined)
    throw new BadRequestException(
      'Nome, especialidade e duração obrigatórios.',
    );
  return {
    ...dto,
    name: dto.name,
    specialtyId: dto.specialtyId,
    durationMinutes: dto.durationMinutes,
  };
}
export function catalogFilter(query: unknown, services = false): CatalogFilter {
  if (!query || typeof query !== 'object' || Array.isArray(query))
    throw new BadRequestException('Filtros inválidos.');
  const input = Object.keys(query).length
    ? fields(query, services ? ['active', 'specialtyId'] : ['active'])
    : {};
  const filter: CatalogFilter = {};
  if ('active' in input) {
    if (input.active !== 'true' && input.active !== 'false')
      throw new BadRequestException('Filtro active inválido.');
    filter.active = input.active === 'true';
  }
  if ('specialtyId' in input) filter.specialtyId = uuid(input.specialtyId);
  return filter;
}
