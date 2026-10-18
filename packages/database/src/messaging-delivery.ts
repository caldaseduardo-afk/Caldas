import { recordAudit } from './audit';
import {
  MessagingProviderError,
  type MessagingProvider,
  type DeliveryStatus,
} from '@atendente/domain';
import type { PrismaClient, Prisma } from './generated/prisma/client';
import { OPERATIONAL_ROLES } from './rbac-catalog';
import { databaseNow } from './hold-expiration';
import { whatsappAccessToken } from './whatsapp-provider';
export interface MessagingNotice {
  tenantId: string;
  conversationId: string;
  messageId: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function messagingPayload(input: unknown): {
  tenantId: string;
  messageId: string;
} {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Job de mensagem inválido.');
  const p = input as Record<string, unknown>;
  if (
    Object.keys(p).length !== 2 ||
    typeof p.tenantId !== 'string' ||
    !uuid.test(p.tenantId) ||
    typeof p.messageId !== 'string' ||
    !uuid.test(p.messageId)
  )
    throw new Error('Job de mensagem inválido.');
  return { tenantId: p.tenantId, messageId: p.messageId };
}
export function messagingLog(
  event: string,
  data: {
    correlationId: string;
    tenantId?: string;
    providerMessageId?: string;
    result: string;
    durationMs: number;
  },
) {
  console.info(
    JSON.stringify({
      event: event.slice(0, 80),
      provider: 'WHATSAPP_CLOUD',
      correlationId: data.correlationId,
      ...(data.tenantId ? { tenantId: data.tenantId } : {}),
      ...(data.providerMessageId
        ? { providerMessageId: data.providerMessageId }
        : {}),
      result: data.result.slice(0, 80),
      durationMs: Math.max(0, Math.trunc(data.durationMs)),
    }),
  );
}
async function transaction<T>(
  client: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await client.$transaction(fn, { isolationLevel: 'Serializable' });
    } catch (e) {
      if (
        e &&
        typeof e === 'object' &&
        'code' in e &&
        ['P2034', 'P2002'].includes(String(e.code)) &&
        i < 5
      )
        continue;
      throw e;
    }
  }
}
// HTTP happens outside the transaction. A SENDING lease that expires is uncertain,
// never a reason to blindly repeat an external side effect.
export async function deliverMessage(
  client: PrismaClient,
  input: unknown,
  provider: MessagingProvider,
  resolveToken = whatsappAccessToken,
): Promise<MessagingNotice | null> {
  const { tenantId, messageId } = messagingPayload(input),
    started = Date.now();
  const row = await transaction(client, async (tx) => {
    const now = await databaseNow(tx);
    const [expired] = await tx.message.updateManyAndReturn({
      where: {
        tenantId,
        id: messageId,
        deliveryStatus: 'SENDING',
        nextAttemptAt: { lte: now },
      },
      data: {
        deliveryStatus: 'FAILED',
        errorCode: 'SEND_UNCERTAIN',
        nextAttemptAt: null,
      },
    });
    if (expired) {
      await recordAudit(tx, {
        data: {
          tenantId,
          resourceId: messageId,
          type: 'MESSAGE_SEND_FAILED',
          changes: { code: 'SEND_UNCERTAIN', source: 'lease_expired' },
        },
      });
      return {
        message: expired,
        integration: null,
        contact: null,
        conversation: null,
        expired: true,
      };
    }
    const [message] = await tx.message.updateManyAndReturn({
      where: {
        tenantId,
        id: messageId,
        deliveryStatus: 'PENDING',
        nextAttemptAt: { lte: now },
        sendAttempts: { lt: 5 },
      },
      data: {
        deliveryStatus: 'SENDING',
        sendingAt: now,
        nextAttemptAt: new Date(+now + 120000),
        sendAttempts: { increment: 1 },
      },
    });
    if (!message) return null;
    const integration = await tx.integration.findFirst({
      where: {
        tenantId,
        id: message.integrationId ?? '',
        status: { in: ['ACTIVE', 'DEGRADED'] },
        tenant: { status: 'ACTIVE' },
      },
    });
    const contact = await tx.contactChannel.findFirst({
      where: {
        tenantId,
        address: message.recipientAddress ?? '',
        type: 'WHATSAPP',
        contact: {
          status: 'ACTIVE',
          conversations: {
            some: {
              tenantId,
              id: message.conversationId,
              integrationId: message.integrationId,
            },
          },
        },
      },
    });
    const conversation = await tx.conversation.findFirst({
      where: {
        tenantId,
        id: message.conversationId,
        integrationId: message.integrationId,
        ...(message.senderType === 'USER'
          ? {
              status: 'HUMAN_ACTIVE',
              assignedUserId: message.senderUserId,
              assignedUser: {
                active: true,
                role: { in: [...OPERATIONAL_ROLES] },
                user: {
                  status: 'ACTIVE',
                  mfaEnabled: false,
                  mfaRequired: false,
                },
                roleDefinition: {
                  enabled: true,
                  AND: [
                    'conversation.view',
                    'contact.view',
                    'conversation.reply',
                  ].map((permissionName) => ({
                    permissions: { some: { permissionName } },
                  })),
                },
              },
            }
          : { status: { in: ['AI_ACTIVE', 'WAITING_PATIENT'] } }),
      },
    });
    return { message, integration, contact, conversation, expired: false };
  });
  if (!row) return null;
  const notice = {
    tenantId,
    conversationId: row.message.conversationId,
    messageId,
  };
  if (row.expired) return notice;
  let providerMessageId: string | undefined,
    failure: MessagingProviderError | undefined;
  try {
    if (!row.conversation)
      throw new MessagingProviderError('AUTHORIZATION_CHANGED', false);
    if (
      !row.integration ||
      !row.contact ||
      !row.message.recipientAddress ||
      row.message.messageType !== 'TEXT'
    )
      throw new MessagingProviderError('DESTINATION_UNAVAILABLE', false);
    providerMessageId = await provider.sendTextMessage(
      {
        phoneNumberId: row.integration.phoneNumberId,
        accessToken: resolveToken(row.integration.credentialsReference),
        to: row.message.recipientAddress,
        messageId,
      },
      row.message.content,
    );
  } catch (error) {
    failure =
      error instanceof MessagingProviderError
        ? error
        : new MessagingProviderError('SEND_UNCERTAIN', true, true);
  }
  // A status webhook may already have advanced the row while HTTP was in flight.
  await transaction(client, async (tx) => {
    const now = await databaseNow(tx);
    const retry =
      failure?.retryable && !failure.uncertain && row.message.sendAttempts < 5;
    const updated = await tx.message.updateMany({
      where: {
        tenantId,
        id: messageId,
        deliveryStatus: 'SENDING',
        sendAttempts: row.message.sendAttempts,
      },
      data: providerMessageId
        ? {
            providerMessageId,
            deliveryStatus: 'SENT',
            sentAt: now,
            nextAttemptAt: null,
            errorCode: null,
          }
        : {
            deliveryStatus: retry ? 'PENDING' : 'FAILED',
            nextAttemptAt: retry
              ? new Date(+now + 5000 * 2 ** (row.message.sendAttempts - 1))
              : null,
            errorCode: failure?.code ?? 'SEND_UNCERTAIN',
          },
    });
    if (updated.count) {
      await recordAudit(tx, {
        data: {
          tenantId,
          resourceId: messageId,
          type: providerMessageId
            ? 'MESSAGE_SEND_SUCCEEDED'
            : 'MESSAGE_SEND_FAILED',
          changes: {
            conversationId: row.message.conversationId,
            attempt: row.message.sendAttempts,
            code: failure?.code ?? null,
            retry: !!retry,
          },
        },
      });
      if (failure?.code === 'CREDENTIALS' && row.integration)
        await tx.integration.updateMany({
          where: {
            tenantId,
            id: row.integration.id,
            status: { in: ['ACTIVE', 'DEGRADED'] },
          },
          data: { status: 'ERROR' },
        });
    }
  });
  messagingLog(providerMessageId ? 'send_succeeded' : 'send_failed', {
    correlationId: messageId,
    tenantId,
    providerMessageId,
    result: failure?.code ?? 'SENT',
    durationMs: Date.now() - started,
  });
  return notice;
}
export async function applyMessagingStatus(
  client: PrismaClient,
  event: DeliveryStatus,
): Promise<MessagingNotice | null> {
  return transaction(client, async (tx) => {
    const integration = await tx.integration.findFirst({
      where: {
        provider: 'WHATSAPP_CLOUD',
        phoneNumberId: event.phoneNumberId,
        externalAccountId: event.accountId,
        status: { not: 'DISABLED' },
        tenant: { status: 'ACTIVE' },
      },
    });
    if (!integration) return null;
    const tenantId = integration.tenantId;
    const row = await tx.message.findFirst({
      where: {
        tenantId,
        integrationId: integration.id,
        senderType: { in: ['USER', 'AI'] },
        recipientAddress: '+' + event.recipient,
        OR: [
          { providerMessageId: event.providerMessageId },
          ...(event.correlationId && uuid.test(event.correlationId)
            ? [
                {
                  id: event.correlationId,
                  providerMessageId: null,
                  sendAttempts: { gt: 0 },
                },
              ]
            : []),
        ],
      },
    });
    if (!row) return null;
    const rank = {
      LOCAL: 0,
      RECEIVED: 0,
      PENDING: 0,
      SENDING: 0,
      FAILED: 0,
      SENT: 1,
      DELIVERED: 2,
      READ: 3,
    };
    if (
      event.status === 'FAILED'
        ? (row.deliveryStatus === 'FAILED' &&
            row.providerMessageId === event.providerMessageId &&
            row.errorCode === 'PROVIDER_DELIVERY_FAILED') ||
          rank[row.deliveryStatus] >= 2
        : rank[event.status] <= rank[row.deliveryStatus]
    )
      return null;
    const now = await databaseNow(tx);
    const at = new Date(
      Math.max(
        +row.createdAt,
        +(row.sentAt ?? row.createdAt),
        Math.min(+event.at, +now),
      ),
    );
    const data: Prisma.MessageUpdateManyMutationInput = {
      deliveryStatus: event.status,
      providerMessageId: event.providerMessageId,
      nextAttemptAt: null,
      errorCode: event.status === 'FAILED' ? 'PROVIDER_DELIVERY_FAILED' : null,
    };
    if (event.status !== 'FAILED') data.sentAt = row.sentAt ?? at;
    if (event.status === 'DELIVERED' || event.status === 'READ')
      data.deliveredAt = row.deliveredAt ?? at;
    if (event.status === 'READ')
      data.readAt = new Date(Math.max(+at, +(row.deliveredAt ?? at)));
    await tx.message.updateMany({ where: { tenantId, id: row.id }, data });
    await recordAudit(tx, {
      data: {
        tenantId,
        resourceId: row.id,
        type: 'MESSAGE_RECEIPT_UPDATED',
        changes: { conversationId: row.conversationId, kind: event.status },
      },
    });
    return { tenantId, conversationId: row.conversationId, messageId: row.id };
  });
}
