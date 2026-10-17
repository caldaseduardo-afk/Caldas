import {
  recordAiAuditMany as recordAuditMany,
  recordAiAudit as recordAudit,
} from '@atendente/database';
import { Injectable } from '@nestjs/common';
import {
  databaseNow,
  startHumanSlaCycle,
  type ConversationEngineJob,
  type ConversationEngineNotice,
  type Prisma,
} from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import { ConversationEngineConfig } from './conversation-engine.config';
import type { ConversationEngineOutput } from './conversation-engine.output';

export interface EngineContext {
  tenant: { name: string; timezone: string };
  conversation: {
    id: string;
    contactId: string;
    activePatientId: string | null;
    status: string;
    intent: string;
    summary: string | null;
  };
  contact: { displayName: string };
  patient: { id: string; name: string; authorizationLevel: string } | null;
  messages: {
    id: string;
    senderType: string;
    content: string;
    createdAt: Date;
  }[];
}
export interface EngineGrant {
  tenantId: string;
  conversationId: string;
  runId: string;
  leaseOwnerId: string;
  correlationId: string;
}

export type ClaimResult =
  | {
      outcome: 'claimed';
      grant: EngineGrant;
      context: EngineContext;
      notices: ConversationEngineNotice[];
    }
  | {
      outcome: 'terminal' | 'deferred' | 'blocked';
      notices: ConversationEngineNotice[];
    };

@Injectable()
export class ConversationEngineRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConversationEngineConfig,
  ) {}

  async bindConfiguration(grant: EngineGrant, versionId: string | null) {
    const updated = await this.database.client.aIProcessingRun.updateMany({
      where: {
        id: grant.runId,
        tenantId: grant.tenantId,
        conversationId: grant.conversationId,
        status: 'PROCESSING',
      },
      data: { aiConfigurationVersionId: versionId },
    });
    if (updated.count !== 1) throw new Error('ENGINE_STATE_CHANGED');
  }

  private async transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.database.client.$transaction(fn, {
          isolationLevel: 'Serializable',
        });
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : '';
        if (['P2034', 'P2002'].includes(code) && attempt < 5) continue;
        throw error;
      }
    }
  }

  async claim(
    job: ConversationEngineJob,
    ownerId: string,
  ): Promise<ClaimResult> {
    return this.transaction(async (tx) => {
      const now = await databaseNow(tx);
      const run = await tx.aIProcessingRun.findFirst({
        where: {
          id: job.runId,
          tenantId: job.tenantId,
          conversationId: job.conversationId,
          inboundMessageId: job.messageId,
          tenant: { status: 'ACTIVE' },
          inboundMessage: {
            tenantId: job.tenantId,
            conversationId: job.conversationId,
            senderType: 'PATIENT',
          },
        },
        include: { inboundMessage: { select: { createdAt: true } } },
      });
      if (!run) throw new Error('ENGINE_JOB_INVALID');
      if (['COMPLETED', 'FAILED', 'SKIPPED'].includes(run.status))
        return { outcome: 'terminal', notices: [] };

      const conversation = await tx.conversation.findFirst({
        where: { id: job.conversationId, tenantId: job.tenantId },
        select: { status: true },
      });
      if (!conversation) throw new Error('ENGINE_JOB_INVALID');
      if (!['AI_ACTIVE', 'WAITING_PATIENT'].includes(conversation.status)) {
        await tx.aIProcessingRun.updateMany({
          where: {
            id: run.id,
            tenantId: job.tenantId,
            status: { in: ['PENDING', 'PROCESSING'] },
          },
          data: {
            status: 'SKIPPED',
            errorCode: 'STATE_BLOCKED',
            completedAt: now,
          },
        });
        await recordAudit(tx, {
          data: {
            tenantId: job.tenantId,
            resourceId: run.id,
            type: 'CONVERSATION_ENGINE_FAILED',
            changes: {
              code: 'STATE_BLOCKED',
              conversationId: job.conversationId,
            },
          },
        });
        return { outcome: 'blocked', notices: [] };
      }

      const earlier = await tx.aIProcessingRun.findFirst({
        where: {
          tenantId: job.tenantId,
          conversationId: job.conversationId,
          id: { not: run.id },
          status: { in: ['PENDING', 'PROCESSING'] },
          OR: [
            {
              inboundMessage: {
                createdAt: { lt: run.inboundMessage.createdAt },
              },
            },
            {
              inboundMessage: { createdAt: run.inboundMessage.createdAt },
              inboundMessageId: { lt: run.inboundMessageId },
            },
          ],
        },
        select: { id: true },
      });
      if (earlier) {
        await tx.aIProcessingRun.update({
          where: { id: run.id },
          data: { status: 'PENDING', nextDispatchAt: new Date(+now + 1000) },
        });
        return { outcome: 'deferred', notices: [] };
      }

      const lease = await tx.conversationEngineLease.findUnique({
        where: {
          tenantId_conversationId: {
            tenantId: job.tenantId,
            conversationId: job.conversationId,
          },
        },
      });
      if (lease && lease.ownerId !== ownerId && lease.expiresAt > now) {
        if (run.status === 'PENDING')
          await tx.aIProcessingRun.update({
            where: { id: run.id },
            data: { nextDispatchAt: new Date(+lease.expiresAt + 100) },
          });
        return { outcome: 'deferred', notices: [] };
      }
      const expiresAt = new Date(+now + this.config.leaseMs);
      await tx.conversationEngineLease.upsert({
        where: {
          tenantId_conversationId: {
            tenantId: job.tenantId,
            conversationId: job.conversationId,
          },
        },
        create: {
          tenantId: job.tenantId,
          conversationId: job.conversationId,
          ownerId,
          expiresAt,
        },
        update: { ownerId, expiresAt },
      });
      const notices: ConversationEngineNotice[] = [];
      if (conversation.status === 'WAITING_PATIENT') {
        await tx.conversation.update({
          where: {
            tenantId_id: { tenantId: job.tenantId, id: job.conversationId },
          },
          data: { status: 'AI_ACTIVE' },
        });
        await recordAudit(tx, {
          data: {
            tenantId: job.tenantId,
            resourceId: job.conversationId,
            type: 'CONVERSATION_STATUS_CHANGED',
            changes: {
              from: 'WAITING_PATIENT',
              to: 'AI_ACTIVE',
              source: 'conversation_engine',
            },
          },
        });
        notices.push({
          type: 'conversation.status_changed',
          tenantId: job.tenantId,
          conversationId: job.conversationId,
        });
      }
      await tx.aIProcessingRun.update({
        where: { id: run.id },
        data: {
          status: 'PROCESSING',
          attempts: { increment: 1 },
          startedAt: run.startedAt ?? now,
          nextDispatchAt: expiresAt,
          errorCode: null,
        },
      });
      await recordAudit(tx, {
        data: {
          tenantId: job.tenantId,
          resourceId: run.id,
          type: 'CONVERSATION_ENGINE_STARTED',
          changes: {
            conversationId: job.conversationId,
            messageId: job.messageId,
          },
        },
      });
      const context = await this.context(
        tx,
        job,
        this.config.historyLimit,
        run.inboundMessage.createdAt,
      );
      return {
        outcome: 'claimed',
        grant: {
          tenantId: job.tenantId,
          conversationId: job.conversationId,
          runId: run.id,
          leaseOwnerId: ownerId,
          correlationId: run.correlationId,
        },
        context,
        notices,
      };
    });
  }

  private async context(
    tx: Prisma.TransactionClient,
    job: ConversationEngineJob,
    limit: number,
    inboundCreatedAt: Date,
  ): Promise<EngineContext> {
    const row = await tx.conversation.findFirst({
      where: {
        id: job.conversationId,
        tenantId: job.tenantId,
        tenant: { status: 'ACTIVE' },
      },
      select: {
        id: true,
        contactId: true,
        activePatientId: true,
        status: true,
        intent: true,
        aiSummary: true,
        tenant: { select: { name: true, timezone: true } },
        contact: { select: { displayName: true } },
      },
    });
    if (!row) throw new Error('ENGINE_CONTEXT_INVALID');
    const link = row.activePatientId
      ? await tx.contactPatient.findFirst({
          where: {
            tenantId: job.tenantId,
            contactId: row.contactId,
            patientId: row.activePatientId,
            active: true,
            relationshipStatus: 'VERIFIED',
            authorizationLevel: { in: ['FULL', 'SCHEDULING_ONLY'] },
          },
          select: {
            patientId: true,
            authorizationLevel: true,
            patient: { select: { name: true } },
          },
        })
      : null;
    const messages = await tx.message.findMany({
      where: {
        tenantId: job.tenantId,
        conversationId: job.conversationId,
        OR: [
          { createdAt: { lt: inboundCreatedAt } },
          { createdAt: inboundCreatedAt, id: { lte: job.messageId } },
        ],
      },
      select: { id: true, senderType: true, content: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return {
      tenant: row.tenant,
      conversation: {
        id: row.id,
        contactId: row.contactId,
        activePatientId: link?.patientId ?? null,
        status: row.status,
        intent: row.intent,
        summary: row.aiSummary,
      },
      contact: row.contact,
      patient: link
        ? {
            id: link.patientId,
            name: link.patient.name,
            authorizationLevel: link.authorizationLevel,
          }
        : null,
      messages: messages.reverse(),
    };
  }

  async renew(grant: EngineGrant) {
    const expiresAt = new Date(Date.now() + this.config.leaseMs);
    const [lease, run] = await this.database.client.$transaction([
      this.database.client.conversationEngineLease.updateMany({
        where: {
          tenantId: grant.tenantId,
          conversationId: grant.conversationId,
          ownerId: grant.leaseOwnerId,
          expiresAt: { gt: new Date() },
        },
        data: { expiresAt },
      }),
      this.database.client.aIProcessingRun.updateMany({
        where: {
          id: grant.runId,
          tenantId: grant.tenantId,
          conversationId: grant.conversationId,
          status: 'PROCESSING',
        },
        data: { nextDispatchAt: expiresAt },
      }),
    ]);
    return lease.count === 1 && run.count === 1;
  }

  async active(grant: EngineGrant) {
    return !!(await this.database.client.aIProcessingRun.findFirst({
      where: {
        id: grant.runId,
        tenantId: grant.tenantId,
        conversationId: grant.conversationId,
        status: 'PROCESSING',
        conversation: {
          status: 'AI_ACTIVE',
          engineLease: {
            ownerId: grant.leaseOwnerId,
            expiresAt: { gt: new Date() },
          },
        },
      },
      select: { id: true },
    }));
  }

  async complete(
    grant: EngineGrant,
    output: ConversationEngineOutput,
    toolCalls: number,
  ): Promise<ConversationEngineNotice[]> {
    return this.transaction(async (tx) => {
      const now = await databaseNow(tx);
      const run = await tx.aIProcessingRun.findFirst({
        where: {
          id: grant.runId,
          tenantId: grant.tenantId,
          conversationId: grant.conversationId,
          status: 'PROCESSING',
          conversation: {
            status: 'AI_ACTIVE',
            engineLease: {
              ownerId: grant.leaseOwnerId,
              expiresAt: { gt: now },
            },
          },
        },
        include: { conversation: true },
      });
      if (!run || run.responseMessageId)
        throw new Error('ENGINE_FINALIZATION_REJECTED');
      const destination = run.conversation.integrationId
        ? await tx.contactChannel.findFirst({
            where: {
              tenantId: grant.tenantId,
              contactId: run.conversation.contactId,
              type: 'WHATSAPP',
            },
            select: { address: true },
          })
        : null;
      const integration = run.conversation.integrationId
        ? await tx.integration.findFirst({
            where: {
              id: run.conversation.integrationId,
              tenantId: grant.tenantId,
              status: { in: ['ACTIVE', 'DEGRADED'] },
            },
            select: { id: true },
          })
        : null;
      const outbound = !!destination && !!integration;
      const message = await tx.message.create({
        data: {
          tenantId: grant.tenantId,
          conversationId: grant.conversationId,
          integrationId: integration?.id,
          channel: run.conversation.channel,
          senderType: 'AI',
          messageType: 'TEXT',
          content: output.response!,
          createdAt: now,
          ...(outbound
            ? {
                deliveryStatus: 'PENDING',
                recipientAddress: destination.address,
                nextAttemptAt: now,
              }
            : {}),
        },
      });
      const nextStatus = output.waitingForPatient
        ? 'WAITING_PATIENT'
        : 'AI_ACTIVE';
      await tx.conversation.update({
        where: {
          tenantId_id: { tenantId: grant.tenantId, id: grant.conversationId },
        },
        data: {
          intent: output.intent,
          status: nextStatus,
          aiSummary: output.summary,
          aiSummaryUpdatedAt: output.summary ? now : undefined,
        },
      });
      await tx.aIProcessingRun.update({
        where: { id: grant.runId },
        data: {
          status: 'COMPLETED',
          responseMessageId: message.id,
          toolCalls,
          completedAt: now,
        },
      });
      if (outbound)
        await recordAudit(tx, {
          data: {
            tenantId: grant.tenantId,
            resourceId: message.id,
            type: 'MESSAGE_SEND_REQUESTED',
            changes: {
              conversationId: grant.conversationId,
              source: 'conversation_engine',
            },
          },
        });
      await recordAuditMany(tx, {
        data: [
          {
            tenantId: grant.tenantId,
            resourceId: message.id,
            type: 'MESSAGE_CREATED',
            changes: {
              conversationId: grant.conversationId,
              senderType: 'AI',
              messageType: 'TEXT',
            },
          },
          {
            tenantId: grant.tenantId,
            resourceId: grant.runId,
            type: 'CONVERSATION_ENGINE_COMPLETED',
            changes: {
              conversationId: grant.conversationId,
              messageId: message.id,
              intent: output.intent,
              toolCalls,
            },
          },
        ],
      });
      await tx.conversationEngineLease.deleteMany({
        where: {
          tenantId: grant.tenantId,
          conversationId: grant.conversationId,
          ownerId: grant.leaseOwnerId,
        },
      });
      return [
        {
          type: 'message.created',
          tenantId: grant.tenantId,
          conversationId: grant.conversationId,
          messageId: message.id,
        },
        {
          type:
            nextStatus === 'AI_ACTIVE'
              ? 'conversation.updated'
              : 'conversation.status_changed',
          tenantId: grant.tenantId,
          conversationId: grant.conversationId,
        },
      ];
    });
  }

  async handoff(
    grant: EngineGrant,
    reason: ConversationEngineOutput['handoffReason'],
    summary: string | null,
    toolCalls: number,
    errorCode?: string,
  ): Promise<ConversationEngineNotice[]> {
    return this.transaction(async (tx) => {
      const now = await databaseNow(tx);
      const run = await tx.aIProcessingRun.findFirst({
        where: {
          id: grant.runId,
          tenantId: grant.tenantId,
          conversationId: grant.conversationId,
          status: 'PROCESSING',
        },
        include: { conversation: true },
      });
      if (!run) return [];
      if (run.conversation.status === 'AI_ACTIVE') {
        await tx.conversation.update({
          where: {
            tenantId_id: { tenantId: grant.tenantId, id: grant.conversationId },
          },
          data: {
            status: 'NEEDS_HUMAN',
            handoffReason: reason ?? 'OTHER',
            handoffRequestedAt: now,
            assignedUserId: null,
            assignedAt: null,
            aiSummary: summary,
            aiSummaryUpdatedAt: summary ? now : undefined,
            slaLevel: 'NONE',
          },
        });
        await startHumanSlaCycle(tx, grant.tenantId, grant.conversationId, now);
      }
      await tx.aIProcessingRun.update({
        where: { id: grant.runId },
        data: {
          status: errorCode ? 'FAILED' : 'COMPLETED',
          errorCode,
          toolCalls,
          completedAt: now,
        },
      });
      await recordAuditMany(tx, {
        data: [
          {
            tenantId: grant.tenantId,
            resourceId: grant.conversationId,
            type: 'CONVERSATION_ENGINE_HANDOFF',
            changes: {
              runId: grant.runId,
              reason: reason ?? 'OTHER',
              errorCode: errorCode ?? null,
            },
          },
          ...(errorCode
            ? [
                {
                  tenantId: grant.tenantId,
                  resourceId: grant.runId,
                  type: 'CONVERSATION_ENGINE_FAILED' as const,
                  changes: {
                    conversationId: grant.conversationId,
                    code: errorCode,
                  },
                },
              ]
            : []),
        ],
      });
      await tx.conversationEngineLease.deleteMany({
        where: {
          tenantId: grant.tenantId,
          conversationId: grant.conversationId,
          ownerId: grant.leaseOwnerId,
        },
      });
      return [
        {
          type: 'conversation.status_changed',
          tenantId: grant.tenantId,
          conversationId: grant.conversationId,
        },
      ];
    });
  }

  async finishTransferred(
    grant: EngineGrant,
    toolCalls: number,
    summary: string | null,
  ): Promise<ConversationEngineNotice[]> {
    return this.transaction(async (tx) => {
      const now = await databaseNow(tx);
      const conversation = await tx.conversation.findFirst({
        where: {
          id: grant.conversationId,
          tenantId: grant.tenantId,
          status: 'NEEDS_HUMAN',
        },
        select: { id: true },
      });
      if (!conversation) throw new Error('ENGINE_HANDOFF_INVALID');
      if (summary)
        await tx.conversation.update({
          where: {
            tenantId_id: {
              tenantId: grant.tenantId,
              id: grant.conversationId,
            },
          },
          data: { aiSummary: summary, aiSummaryUpdatedAt: now },
        });
      await tx.aIProcessingRun.updateMany({
        where: {
          id: grant.runId,
          tenantId: grant.tenantId,
          status: 'PROCESSING',
        },
        data: { status: 'COMPLETED', toolCalls, completedAt: now },
      });
      await recordAudit(tx, {
        data: {
          tenantId: grant.tenantId,
          resourceId: grant.conversationId,
          type: 'CONVERSATION_ENGINE_HANDOFF',
          changes: {
            runId: grant.runId,
            source: 'transfer_to_human',
          },
        },
      });
      await tx.conversationEngineLease.deleteMany({
        where: {
          tenantId: grant.tenantId,
          conversationId: grant.conversationId,
          ownerId: grant.leaseOwnerId,
        },
      });
      return [
        {
          type: 'conversation.status_changed',
          tenantId: grant.tenantId,
          conversationId: grant.conversationId,
        },
      ];
    });
  }
}
