import { BadRequestException } from '@nestjs/common';
import type { PermissionName } from '@atendente/database';
import { fields } from '../configuration/dto';
import { uuid } from '../availability/availability.dto';
import { choice } from './conversation.dto';
import { handoffReasons } from './conversation.state';
import { viewPermissions } from './conversation-access';
export const handoffActions = [
  'request-human',
  'claim',
  'transfer',
  'return-to-ai',
  'resolve',
] as const;
export type HandoffAction = (typeof handoffActions)[number];
export function handoffPermissions(action: HandoffAction): PermissionName[] {
  return [
    ...viewPermissions,
    ...(
      {
        'request-human': ['conversation.reply'],
        claim: ['conversation.assign', 'conversation.reply'],
        transfer: ['conversation.transfer'],
        'return-to-ai': ['conversation.transfer'],
        resolve: ['conversation.close'],
      } satisfies Record<HandoffAction, PermissionName[]>
    )[action],
  ];
}
export function handoffDto(action: HandoffAction, body: unknown) {
  if (action === 'request-human') {
    const input = fields(body, ['reason']);
    return { reason: choice(input.reason, handoffReasons) };
  }
  if (action === 'transfer') {
    const input = fields(body, ['targetUserId']);
    return { targetUserId: uuid(input.targetUserId) };
  }
  if (
    body !== undefined &&
    (!body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length)
  )
    throw new BadRequestException('Esta operação não aceita campos.');
  return {};
}
