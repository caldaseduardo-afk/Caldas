import { BadRequestException } from '@nestjs/common';
import { fields, textField, timezoneField } from '../configuration/dto';

export interface CreateClinicDto {
  name: string;
  timezone: string;
}
export interface UpdateClinicDto {
  name?: string;
  timezone?: string;
  status?: 'ACTIVE' | 'INACTIVE';
}
export function createClinicDto(body: unknown): CreateClinicDto {
  const input = fields(body, ['name', 'timezone']);
  return {
    name: textField(input.name, 200),
    timezone: timezoneField(input.timezone),
  };
}
export function updateClinicDto(body: unknown): UpdateClinicDto {
  const input = fields(body, ['name', 'timezone', 'status']);
  const dto: UpdateClinicDto = {};
  if ('name' in input) dto.name = textField(input.name, 200);
  if ('timezone' in input) dto.timezone = timezoneField(input.timezone);
  if ('status' in input) {
    if (input.status !== 'ACTIVE' && input.status !== 'INACTIVE')
      throw new BadRequestException('Status inválido.');
    dto.status = input.status;
  }
  return dto;
}
