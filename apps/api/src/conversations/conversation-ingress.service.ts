import { recordIntegrationAudit as recordAudit } from '@atendente/database';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { InboundMessage, DeliveryStatus } from '@atendente/domain';
import { databaseNow, applyMessagingStatus } from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import { normalizePhone } from '../contacts/phone';
import { messageDto } from './conversation.dto';
import { getOrCreateConversation } from './conversation-create';
import { RealtimeEvents, type EventDraft } from '../realtime/realtime.events';
import { ConversationEngineEnqueuer } from './conversation-engine-enqueuer';

@Injectable()
export class ConversationIngressService {
  constructor(
    private readonly database: DatabaseService,
    private readonly events: RealtimeEvents,
    private readonly engine: ConversationEngineEnqueuer,
  ) {}
  async receive(event: InboundMessage, correlationId = randomUUID()) {
    const phone = normalizePhone('+' + event.from);
    const metadata = event.metadata ? { ...event.metadata } : undefined;
    if (event.messageType === 'CONTACT' && metadata) {
      metadata.phone = normalizePhone(metadata.phone);
      delete metadata.sharedContactCount;
    }
    const dto = messageDto(
      {
        messageType: event.messageType,
        content: event.content,
        metadata,
        providerMessageId: event.providerMessageId,
      },
      true,
    );
    for (let attempt = 0; ; attempt++) {
      const pending: EventDraft[] = [];
      try {
        const result = await this.database.client.$transaction(
          async (tx) => {
            const integration = await tx.integration.findFirst({
              where: {
                provider: 'WHATSAPP_CLOUD',
                type: 'WHATSAPP',
                phoneNumberId: event.phoneNumberId,
                externalAccountId: event.accountId,
                status: { not: 'DISABLED' },
                tenant: { status: 'ACTIVE' },
              },
            });
            if (!integration) return { outcome: 'integration_not_found' };
            const tenantId = integration.tenantId;
            const existing = await tx.message.findFirst({
              where: {
                tenantId,
                integrationId: integration.id,
                providerMessageId: dto.providerMessageId,
              },
              select: {
                id: true,
                conversationId: true,
                inboundProcessingRun: { select: { id: true } },
              },
            });
            if (existing)
              return {
                outcome: 'webhook_duplicate',
                tenantId,
                ...(existing.inboundProcessingRun
                  ? {
                      engineJob: {
                        tenantId,
                        conversationId: existing.conversationId,
                        messageId: existing.id,
                        runId: existing.inboundProcessingRun.id,
                      },
                    }
                  : {}),
              };
            let channel = await tx.contactChannel.findFirst({
              where: { tenantId, type: 'WHATSAPP', address: phone },
              include: { contact: true },
            });
            if (!channel) {
              const phoneChannel = await tx.contactChannel.findFirst({
                where: { tenantId, type: 'PHONE', address: phone },
                include: { contact: true },
              });
              const contact =
                phoneChannel?.contact ??
                (await tx.contact.create({
                  data: { tenantId, displayName: event.displayName },
                }));
              if (contact.status !== 'ACTIVE')
                return { outcome: 'contact_inactive', tenantId };
              await tx.contact.updateMany({
                where: { tenantId, id: contact.id, status: 'ACTIVE' },
                data: { updatedAt: new Date() },
              });
              const primary = !(await tx.contactChannel.count({
                where: { tenantId, contactId: contact.id },
              }));
              channel = await tx.contactChannel.create({
                data: {
                  tenantId,
                  contactId: contact.id,
                  type: 'WHATSAPP',
                  address: phone,
                  providerExternalId: event.from,
                  primary,
                },
                include: { contact: true },
              });
              if (!phoneChannel)
                await recordAudit(
                  tx,
                  {
                    data: {
                      tenantId,
                      resourceId: contact.id,
                      type: 'CONTACT_CREATED',
                      changes: { source: 'WHATSAPP' },
                    },
                  },
                  correlationId,
                  integration.id,
                );
              await recordAudit(
                tx,
                {
                  data: {
                    tenantId,
                    resourceId: channel.id,
                    type: 'CONTACT_CHANNEL_CREATED',
                    changes: { contactId: contact.id, source: 'WHATSAPP' },
                  },
                },
                correlationId,
                integration.id,
              );
            }
            if (channel.contact.status !== 'ACTIVE')
              return { outcome: 'contact_inactive', tenantId };
            await tx.contact.updateMany({
              where: { tenantId, id: channel.contactId, status: 'ACTIVE' },
              data: { updatedAt: new Date() },
            });
            const conversation = await getOrCreateConversation(
              tx,
              tenantId,
              channel.contactId,
              integration.id,
              pending,
              undefined,
              correlationId,
            );
            await tx.conversation.updateMany({
              where: { tenantId, id: conversation.id },
              data: { updatedAt: new Date() },
            });
            const message = await tx.message.create({
              data: {
                tenantId,
                integrationId: integration.id,
                conversationId: conversation.id,
                channel: 'WHATSAPP',
                senderType: 'PATIENT',
                deliveryStatus: 'RECEIVED',
                messageType: dto.messageType,
                content: dto.content,
                metadata: dto.metadata,
                providerMessageId: dto.providerMessageId,
                createdAt: await databaseNow(tx),
              },
            });
            await recordAudit(
              tx,
              {
                data: {
                  tenantId,
                  resourceId: message.id,
                  type: 'MESSAGE_CREATED',
                  changes: {
                    conversationId: conversation.id,
                    senderType: 'PATIENT',
                    messageType: message.messageType,
                  },
                },
              },
              correlationId,
              integration.id,
            );
            pending.push({
              type: 'message.created',
              tenantId,
              conversationId: conversation.id,
              messageId: message.id,
            });
            const run = await tx.aIProcessingRun.create({
              data: {
                tenantId,
                conversationId: conversation.id,
                inboundMessageId: message.id,
                correlationId,
              },
              select: { id: true },
            });
            return {
              outcome: 'message_persisted',
              tenantId,
              engineJob: {
                tenantId,
                conversationId: conversation.id,
                messageId: message.id,
                runId: run.id,
              },
            };
          },
          { isolationLevel: 'Serializable' },
        );
        for (const notice of pending) this.events.publish(notice);
        if ('engineJob' in result && result.engineJob)
          await this.engine.enqueue(result.engineJob);
        return result;
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          ['P2034', 'P2002'].includes(String(error.code)) &&
          attempt < 5
        )
          continue;
        throw error;
      }
    }
  }
  async status(event: DeliveryStatus) {
    const notice = await applyMessagingStatus(this.database.client, event);
    if (notice)
      this.events.publish({ ...notice, type: 'message.status_updated' });
    return {
      outcome: notice ? 'status_updated' : 'status_ignored',
      tenantId: notice?.tenantId,
    };
  }
}
