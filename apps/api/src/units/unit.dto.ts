import { BadRequestException } from '@nestjs/common';
import { fields, textField, timezoneField } from '../configuration/dto';

export interface CreateUnitDto {
  name: string;
  address: string;
  active: boolean;
  timezoneOverride: string | null;
}
export type UpdateUnitDto = Partial<CreateUnitDto>;
export function updateUnitDto(body: unknown): UpdateUnitDto {
  const input = fields(body, ['name', 'address', 'active', 'timezoneOverride']);
  const dto: UpdateUnitDto = {};
  if ('name' in input) dto.name = textField(input.name, 200);
  if ('address' in input) dto.address = textField(input.address, 2000);
  if ('active' in input) {
    if (typeof input.active !== 'boolean')
      throw new BadRequestException('Status inválido.');
    dto.active = input.active;
  }
  if ('timezoneOverride' in input)
    dto.timezoneOverride =
      input.timezoneOverride === null
        ? null
        : timezoneField(input.timezoneOverride);
  return dto;
}
export function createUnitDto(body: unknown): CreateUnitDto {
  const dto = updateUnitDto(body);
  if (!dto.name || !dto.address)
    throw new BadRequestException('Nome e endereço obrigatórios.');
  return {
    name: dto.name,
    address: dto.address,
    active: dto.active ?? true,
    timezoneOverride: dto.timezoneOverride ?? null,
  };
}
