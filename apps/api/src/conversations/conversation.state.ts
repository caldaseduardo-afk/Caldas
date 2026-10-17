import { ConflictException } from '@nestjs/common';
export const conversationStatuses = [
  'AI_ACTIVE',
  'WAITING_PATIENT',
  'NEEDS_HUMAN',
  'HUMAN_ACTIVE',
  'RESOLVED',
  'CLOSED',
] as const;
export type ConversationState = (typeof conversationStatuses)[number];
export const openStatuses: ConversationState[] = [
  'AI_ACTIVE',
  'WAITING_PATIENT',
  'NEEDS_HUMAN',
  'HUMAN_ACTIVE',
];
export const intents = [
  'SCHEDULING',
  'RESCHEDULING',
  'CANCELLATION',
  'CONFIRMATION',
  'INFORMATION',
  'PAYMENT',
  'COMPLAINT',
  'CLINICAL_QUESTION',
  'OTHER',
] as const;
export const handoffReasons = [
  'USER_REQUESTED_HUMAN',
  'AI_LOW_CONFIDENCE',
  'PAYMENT_NEGOTIATION',
  'COMPLAINT',
  'CLINICAL_QUESTION',
  'AUTHORIZATION_PROBLEM',
  'SCHEDULING_CONFLICT',
  'SYSTEM_ERROR',
  'OTHER',
] as const;
const transitions: Record<ConversationState, readonly ConversationState[]> = {
  AI_ACTIVE: ['WAITING_PATIENT', 'NEEDS_HUMAN', 'RESOLVED'],
  WAITING_PATIENT: ['AI_ACTIVE', 'NEEDS_HUMAN', 'RESOLVED'],
  NEEDS_HUMAN: ['HUMAN_ACTIVE'],
  HUMAN_ACTIVE: ['AI_ACTIVE', 'RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
};
export function assertConversationTransition(
  from: ConversationState,
  to: ConversationState,
) {
  if (!transitions[from].includes(to))
    throw new ConflictException('Transição de conversa inválida.');
}
export function assertOpen(status: ConversationState) {
  if (!openStatuses.includes(status))
    throw new ConflictException('Conversa encerrada.');
}

export function canAiRespond(conversation: { status: ConversationState }) {
  return conversation.status === 'AI_ACTIVE';
}
