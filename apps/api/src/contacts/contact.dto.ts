import { BadRequestException } from '@nestjs/common';
import { fields, textField } from '../configuration/dto';
import { normalizePhone } from './phone';

export interface CreateChannelDto {
  type: 'PHONE' | 'WHATSAPP';
  address: string;
  primary?: boolean;
  providerExternalId?: string | null;
}
export type UpdateChannelDto = Partial<Omit<CreateChannelDto, 'type'>>;
export interface CreateContactDto {
  displayName: string;
  channels: CreateChannelDto[];
}
export interface UpdateContactDto {
  displayName?: string;
  status?: 'ACTIVE' | 'INACTIVE';
}
function channelValues(input: Record<string, unknown>): UpdateChannelDto {
  const dto: UpdateChannelDto = {};
  if ('address' in input) dto.address = normalizePhone(input.address);
  if ('primary' in input) {
    if (typeof input.primary !== 'boolean')
      throw new BadRequestException('Canal principal inválido.');
    dto.primary = input.primary;
  }
  if ('providerExternalId' in input)
    dto.providerExternalId =
      input.providerExternalId === null
        ? null
        : textField(input.providerExternalId, 200);
  return dto;
}
export function createChannelDto(body: unknown): CreateChannelDto {
  const input = fields(body, [
    'type',
    'address',
    'primary',
    'providerExternalId',
  ]);
  if (input.type !== 'PHONE' && input.type !== 'WHATSAPP')
    throw new BadRequestException('Tipo de canal inválido.');
  return {
    ...channelValues(input),
    type: input.type,
    address: normalizePhone(input.address),
  };
}
export function updateChannelDto(body: unknown): UpdateChannelDto {
  return channelValues(
    fields(body, ['address', 'primary', 'providerExternalId']),
  );
}
export function createContactDto(body: unknown): CreateContactDto {
  const input = fields(body, ['displayName', 'channels']);
  const displayName = textField(input.displayName, 200);
  if (
    'channels' in input &&
    (!Array.isArray(input.channels) || input.channels.length > 20)
  )
    throw new BadRequestException('Canais inválidos.');
  const channels = ((input.channels ?? []) as unknown[]).map(createChannelDto);
  if (channels.filter((channel) => channel.primary).length > 1)
    throw new BadRequestException('Escolha apenas um canal principal.');
  return { displayName, channels };
}
export function updateContactDto(body: unknown): UpdateContactDto {
  const input = fields(body, ['displayName', 'status']);
  const dto: UpdateContactDto = {};
  if ('displayName' in input)
    dto.displayName = textField(input.displayName, 200);
  if ('status' in input) {
    if (input.status !== 'ACTIVE' && input.status !== 'INACTIVE')
      throw new BadRequestException('Status inválido.');
    dto.status = input.status;
  }
  return dto;
}
export function contactQuery(query: Record<string, unknown>) {
  if (Object.keys(query).some((key) => key !== 'phone'))
    throw new BadRequestException('Filtro inválido.');
  return 'phone' in query ? normalizePhone(query.phone) : undefined;
}
