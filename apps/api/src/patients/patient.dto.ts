import { BadRequestException } from '@nestjs/common';
import { fields, textField } from '../configuration/dto';

export interface PatientDto {
  name: string;
  birthDate: Date;
  document?: string | null;
  healthPlan?: string | null;
  paymentPreference?: string | null;
  notes?: string | null;
}
function birthDate(value: unknown): Date {
  if (
    typeof value !== 'string' ||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) ||
    value.slice(0, 4) === '0000'
  )
    throw new BadRequestException('Data de nascimento inválida.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value ||
    value > new Date().toISOString().slice(0, 10)
  )
    throw new BadRequestException('Data de nascimento inválida.');
  return date;
}
const allowed = [
  'name',
  'birthDate',
  'document',
  'healthPlan',
  'paymentPreference',
  'notes',
];
export function updatePatientDto(body: unknown): Partial<PatientDto> {
  const input = fields(body, allowed);
  const dto: Partial<PatientDto> = {};
  if ('name' in input) dto.name = textField(input.name, 200);
  if ('birthDate' in input) dto.birthDate = birthDate(input.birthDate);
  for (const key of ['document', 'healthPlan', 'paymentPreference'] as const)
    if (key in input)
      dto[key] =
        input[key] === null
          ? null
          : textField(input[key], key === 'document' ? 80 : 200);
  if ('notes' in input) {
    if (input.notes === null) dto.notes = null;
    else {
      if (
        typeof input.notes !== 'string' ||
        !input.notes.trim() ||
        input.notes.length > 4000 ||
        [...input.notes].some(
          (char) =>
            (char.charCodeAt(0) < 32 && !'\n\r\t'.includes(char)) ||
            char.charCodeAt(0) === 127,
        )
      )
        throw new BadRequestException('Notas inválidas.');
      dto.notes = input.notes.trim();
    }
  }
  return dto;
}
export function createPatientDto(body: unknown): PatientDto {
  const dto = updatePatientDto(body);
  if (!dto.name || !dto.birthDate)
    throw new BadRequestException('Nome e nascimento obrigatórios.');
  return { ...dto, name: dto.name, birthDate: dto.birthDate };
}
