import { recordAudit } from '@atendente/database';
import type { Prisma } from '@atendente/database';
import type { EventDraft } from '../realtime/realtime.events';
import { conversationFields } from './conversation-access';
import { openStatuses } from './conversation.state';

// Caller locks and validates the tenant/contact in its authenticated transaction.
// The channel/integration dimension is shared by HTTP and authenticated provider ingress.
export async function getOrCreateConversation(
  tx: Prisma.TransactionClient,
  tenantId: string,
  contactId: string,
  integrationId: string | null,
  pending: EventDraft[],
  userId?: string,
) {
  const existing = await tx.conversation.findFirst({
    where: {
      tenantId,
      contactId,
      channel: 'WHATSAPP',
      integrationId,
      status: { in: openStatuses },
    },
    select: conversationFields,
  });
  if (existing) return existing;
  const row = await tx.conversation.create({
    data: { tenantId, contactId, channel: 'WHATSAPP', integrationId },
    select: conversationFields,
  });
  await recordAudit(
    tx,
    {
      data: {
        tenantId,
        userId,
        resourceId: row.id,
        type: 'CONVERSATION_CREATED',
        changes: { channel: row.channel, status: row.status, contactId },
      },
    },
    !userId && integrationId
      ? {
          tenantId,
          actorType: 'INTEGRATION',
          source: 'WHATSAPP',
          actorReferenceId: integrationId,
        }
      : undefined,
  );
  pending.push({
    type: 'conversation.created',
    tenantId,
    conversationId: row.id,
  });
  return row;
}
