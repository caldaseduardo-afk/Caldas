import { BadRequestException } from '@nestjs/common';
import { fields } from '../configuration/dto';

export const relationshipTypes = ['SELF', 'MOTHER', 'FATHER', 'SON_DAUGHTER', 'SPOUSE', 'LEGAL_GUARDIAN', 'CAREGIVER', 'SECRETARY', 'OTHER'] as const;
export interface RelationshipDto {
  relationshipType: (typeof relationshipTypes)[number];
  relationshipStatus?: 'DECLARED' | 'VERIFIED';
  authorizationLevel?: 'FULL' | 'SCHEDULING_ONLY' | 'NO_ACCESS';
  isPrimaryContact?: boolean; legalRepresentative?: boolean;
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new BadRequestException('Identificador inválido.');
  return value;
}
const keys = ['relationshipType', 'relationshipStatus', 'authorizationLevel', 'isPrimaryContact', 'legalRepresentative'];
function parse(input: Record<string, unknown>): Partial<RelationshipDto> {
  const dto: Partial<RelationshipDto> = {};
  if ('relationshipType' in input) {
    if (!relationshipTypes.includes(input.relationshipType as RelationshipDto['relationshipType'])) throw new BadRequestException('Relacionamento inválido.');
    dto.relationshipType = input.relationshipType as RelationshipDto['relationshipType'];
  }
  if ('relationshipStatus' in input) {
    if (input.relationshipStatus !== 'DECLARED' && input.relationshipStatus !== 'VERIFIED') throw new BadRequestException('Use a operação de revogação para revogar.');
    dto.relationshipStatus = input.relationshipStatus;
  }
  if ('authorizationLevel' in input) {
    if (!['FULL', 'SCHEDULING_ONLY', 'NO_ACCESS'].includes(String(input.authorizationLevel))) throw new BadRequestException('Autorização inválida.');
    dto.authorizationLevel = input.authorizationLevel as RelationshipDto['authorizationLevel'];
  }
  for (const key of ['isPrimaryContact', 'legalRepresentative'] as const)
    if (key in input) {
      if (typeof input[key] !== 'boolean') throw new BadRequestException('Indicador inválido.');
      dto[key] = input[key];
    }
  return dto;
}
export function createRelationshipDto(body: unknown): RelationshipDto & { contactId: string } {
  const input = fields(body, ['contactId', ...keys]);
  const dto = parse(input);
  if (!dto.relationshipType) throw new BadRequestException('Relacionamento obrigatório.');
  return { ...dto, relationshipType: dto.relationshipType, contactId: uuid(input.contactId) };
}
export function updateRelationshipDto(body: unknown) { return parse(fields(body, keys)); }
export function needsAuthorization(dto: Partial<RelationshipDto>) {
  return dto.relationshipStatus === 'VERIFIED' || (dto.authorizationLevel !== undefined && dto.authorizationLevel !== 'NO_ACCESS') || dto.legalRepresentative === true;
}
export function hasPolicyDecision(dto: Partial<RelationshipDto>) {
  return dto.relationshipStatus !== undefined || dto.authorizationLevel !== undefined || dto.legalRepresentative !== undefined;
}
