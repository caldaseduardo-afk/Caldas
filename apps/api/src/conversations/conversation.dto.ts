import { BadRequestException } from '@nestjs/common';
import { fields, textField } from '../configuration/dto';
import { uuid, civilDate } from '../availability/availability.dto';
import {
  conversationStatuses,
  intents,
  handoffReasons,
} from './conversation.state';
export const messageTypes = [
  'TEXT',
  'IMAGE',
  'AUDIO',
  'DOCUMENT',
  'LOCATION',
  'CONTACT',
  'INTERACTIVE',
] as const;
export const channels = ['WHATSAPP'] as const;
export function choice<T extends string>(
  value: unknown,
  choices: readonly T[],
): T {
  if (typeof value !== 'string' || !choices.includes(value as T))
    throw new BadRequestException('Opção inválida.');
  return value as T;
}
export function createConversationDto(body: unknown) {
  const input = fields(body, ['contactId', 'channel']);
  return {
    contactId: uuid(input.contactId),
    channel:
      input.channel === undefined
        ? ('WHATSAPP' as const)
        : choice(input.channel, channels),
  };
}
export function contextDto(body: unknown) {
  const input = fields(body, ['activePatientId', 'intent']);
  return {
    ...('activePatientId' in input
      ? {
          activePatientId:
            input.activePatientId === null ? null : uuid(input.activePatientId),
        }
      : {}),
    ...('intent' in input ? { intent: choice(input.intent, intents) } : {}),
  };
}
export function conversationStatusDto(body: unknown, internal = false) {
  const input = fields(body, [
    'status',
    'handoffReason',
    ...(internal ? ['assignedUserId'] : []),
  ]);
  const status = choice(input.status, conversationStatuses);
  if (!internal && status === 'HUMAN_ACTIVE')
    throw new BadRequestException('Use a operação de assumir conversa.');
  if ('handoffReason' in input && status !== 'NEEDS_HUMAN')
    throw new BadRequestException('Motivo exige NEEDS_HUMAN.');
  if ('assignedUserId' in input && status !== 'HUMAN_ACTIVE')
    throw new BadRequestException('Responsável exige HUMAN_ACTIVE.');
  return {
    status,
    handoffReason:
      status === 'NEEDS_HUMAN'
        ? input.handoffReason === undefined
          ? ('OTHER' as const)
          : choice(input.handoffReason, handoffReasons)
        : null,
    assignedUserId:
      status === 'HUMAN_ACTIVE' ? uuid(input.assignedUserId) : null,
  };
}
export function pagination(query: Record<string, unknown>) {
  const parse = (x: unknown, fallback: number) => {
    if (x === undefined) return fallback;
    if (typeof x !== 'string' || !/^\d{1,6}$/.test(x))
      throw new BadRequestException('Paginação inválida.');
    return Number(x);
  };
  const page = parse(query.page, 1),
    limit = parse(query.limit, 20);
  if (page < 1 || limit < 1 || limit > 100 || (page - 1) * limit > 10000)
    throw new BadRequestException('Paginação inválida.');
  return { page, limit };
}
function queryFields(query: unknown, keys: string[]) {
  if (
    query &&
    typeof query === 'object' &&
    !Array.isArray(query) &&
    Object.keys(query).length === 0
  )
    return {};
  return fields(query, keys);
}
export function messageQuery(query: unknown) {
  return pagination(queryFields(query, ['page', 'limit']));
}
export function conversationQuery(query: unknown) {
  const input = queryFields(query, [
    'page',
    'limit',
    'status',
    'intent',
    'assignedUserId',
    'contactId',
    'activePatientId',
    'channel',
  ]);
  const filter: {
    status?: (typeof conversationStatuses)[number];
    intent?: (typeof intents)[number];
    assignedUserId?: string;
    contactId?: string;
    activePatientId?: string;
    channel?: 'WHATSAPP';
  } = {};
  if ('status' in input)
    filter.status = choice(input.status, conversationStatuses);
  if ('intent' in input) filter.intent = choice(input.intent, intents);
  if ('channel' in input) filter.channel = choice(input.channel, channels);
  for (const key of ['assignedUserId', 'contactId', 'activePatientId'] as const)
    if (key in input) filter[key] = uuid(input[key]);
  return { ...pagination(input), filter };
}
export interface MessageData {
  requestId?: string;
  messageType: (typeof messageTypes)[number];
  content: string;
  metadata?: { [key: string]: string | number };
  providerMessageId?: string;
}
export function messageDto(body: unknown, incoming = false): MessageData {
  const input = fields(body, [
    'messageType',
    'content',
    'metadata',
    ...(incoming ? ['providerMessageId'] : ['requestId']),
  ]);
  const messageType = choice(input.messageType, messageTypes);
  if (
    input.content !== undefined &&
    (typeof input.content !== 'string' ||
      input.content.length > 4000 ||
      input.content.includes('\u0000'))
  )
    throw new BadRequestException('Conteúdo inválido.');
  const content = typeof input.content === 'string' ? input.content : '';
  if (messageType === 'TEXT' && !content.trim())
    throw new BadRequestException('Texto obrigatório.');
  let metadata: MessageData['metadata'];
  if (messageType === 'TEXT') {
    if (input.metadata != null)
      throw new BadRequestException('Texto não aceita metadata.');
  } else if (['IMAGE', 'AUDIO', 'DOCUMENT'].includes(messageType)) {
    const meta = fields(input.metadata, [
      'mediaRef',
      'mimeType',
      'fileName',
      'sizeBytes',
    ]);
    const mediaRef = textField(meta.mediaRef, 200);
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(mediaRef) ||
      mediaRef.startsWith('data:')
    )
      throw new BadRequestException('Referência de mídia inválida.');
    metadata = { mediaRef };
    for (const key of ['mimeType', 'fileName'] as const)
      if (key in meta)
        metadata[key] = textField(meta[key], key === 'mimeType' ? 100 : 255);
    if ('sizeBytes' in meta) {
      if (
        typeof meta.sizeBytes !== 'number' ||
        !Number.isInteger(meta.sizeBytes) ||
        meta.sizeBytes < 0 ||
        meta.sizeBytes > 2147483647
      )
        throw new BadRequestException('Tamanho inválido.');
      metadata.sizeBytes = meta.sizeBytes;
    }
  } else if (messageType === 'LOCATION') {
    const meta = fields(input.metadata, ['latitude', 'longitude', 'label']);
    for (const [key, max] of [
      ['latitude', 90],
      ['longitude', 180],
    ] as const)
      if (
        typeof meta[key] !== 'number' ||
        !Number.isFinite(meta[key]) ||
        Math.abs(meta[key]) > max
      )
        throw new BadRequestException('Localização inválida.');
    metadata = {
      latitude: meta.latitude as number,
      longitude: meta.longitude as number,
      ...('label' in meta ? { label: textField(meta.label, 200) } : {}),
    };
  } else if (messageType === 'CONTACT') {
    const meta = fields(input.metadata, ['displayName', 'phone']);
    const phone = textField(meta.phone, 16);
    if (!/^\+[1-9]\d{7,14}$/.test(phone))
      throw new BadRequestException('Telefone canônico obrigatório.');
    metadata = { displayName: textField(meta.displayName, 200), phone };
  } else {
    const meta = fields(input.metadata, ['interactionId', 'selectionId']);
    metadata = {
      interactionId: textField(meta.interactionId, 200),
      ...('selectionId' in meta
        ? { selectionId: textField(meta.selectionId, 200) }
        : {}),
    };
  }
  return {
    messageType,
    content,
    ...(!incoming && input.requestId !== undefined
      ? { requestId: uuid(input.requestId) }
      : {}),
    ...(metadata ? { metadata } : {}),
    ...(incoming
      ? { providerMessageId: textField(input.providerMessageId, 300) }
      : {}),
  };
}
export function receiptDto(body: unknown) {
  const input = fields(body, ['kind', 'at']);
  const kind = choice(input.kind, ['DELIVERED', 'READ'] as const);
  if (
    typeof input.at !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(
      input.at,
    )
  )
    throw new BadRequestException('Instante com offset obrigatório.');
  civilDate(input.at.slice(0, 10));
  if (
    Number(input.at.slice(11, 13)) > 23 ||
    Number(input.at.slice(14, 16)) > 59 ||
    Number(input.at.slice(17, 19)) > 59 ||
    /[+-]14:(?!00)/.test(input.at)
  )
    throw new BadRequestException('Instante inválido.');
  const at = new Date(input.at);
  if (!Number.isFinite(+at))
    throw new BadRequestException('Instante inválido.');
  return { kind, at };
}
