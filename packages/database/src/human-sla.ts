import { recordAutomationAudit as recordAudit } from './audit';
import {
  humanSlaSchedule,
  humanSlaLevels,
  resolveHumanSlaLevel,
} from '@atendente/domain';
import type { Prisma, PrismaClient } from './generated/prisma/client';
import { databaseNow } from './hold-expiration';
export interface HumanSlaPayload {
  tenantId: string;
  jobId: string;
}
export interface HumanSlaNotice {
  tenantId: string;
  conversationId: string;
}
export function parseHumanSlaPayload(value: unknown): HumanSlaPayload {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Job SLA inválido.');
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== 2 ||
    typeof row.tenantId !== 'string' ||
    !uuid.test(row.tenantId) ||
    typeof row.jobId !== 'string' ||
    !uuid.test(row.jobId)
  )
    throw new Error('Job SLA inválido.');
  return { tenantId: row.tenantId, jobId: row.jobId };
}
// Caller holds the Conversation write lock; all operations share its transaction.
export async function startHumanSlaCycle(
  tx: Prisma.TransactionClient,
  tenantId: string,
  conversationId: string,
  requestedAt: Date,
) {
  if (!tenantId) throw new Error('Tenant obrigatório.');
  const rule = await tx.humanSlaRule.findFirst({
    where: { tenantId, active: true, tenant: { status: 'ACTIVE' } },
  });
  if (!rule || (!rule.internalAlertEnabled && !rule.externalAlertEnabled))
    return null;
  const existing = await tx.humanSlaCycle.findFirst({
    where: { tenantId, conversationId, endedAt: null },
  });
  if (existing) return existing;
  const conversation = await tx.conversation.findFirst({
    where: {
      id: conversationId,
      tenantId,
      status: 'NEEDS_HUMAN',
      handoffRequestedAt: requestedAt,
    },
  });
  if (!conversation) throw new Error('Contexto SLA inválido.');
  const cycle = await tx.humanSlaCycle.create({
    data: {
      tenantId,
      conversationId,
      ruleId: rule.id,
      requestedAt,
      firstAlertMinutes: rule.firstAlertMinutes,
      secondAlertMinutes: rule.secondAlertMinutes,
      externalAlertMinutes: rule.externalAlertMinutes,
      internalAlertEnabled: rule.internalAlertEnabled,
      externalAlertEnabled: rule.externalAlertEnabled,
    },
  });
  await tx.humanSlaJob.createMany({
    data: humanSlaSchedule(requestedAt, rule).map(({ level, dueAt }) => ({
      tenantId,
      cycleId: cycle.id,
      level,
      dueAt,
    })),
    skipDuplicates: true,
  });
  return cycle;
}
export async function closeHumanSlaCycle(
  tx: Prisma.TransactionClient,
  tenantId: string,
  conversationId: string,
  now: Date,
  claimed = false,
  actorId?: string,
) {
  if (!tenantId) throw new Error('Tenant obrigatório.');
  const cycles = await tx.humanSlaCycle.updateManyAndReturn({
    where: { tenantId, conversationId, endedAt: null },
    data: { endedAt: now, ...(claimed ? { claimedAt: now } : {}) },
    select: { id: true },
  });
  if (!cycles.length) return false;
  await tx.humanSlaJob.updateMany({
    where: {
      tenantId,
      cycleId: { in: cycles.map((c) => c.id) },
      processedAt: null,
    },
    data: { processedAt: now },
  });
  await tx.conversation.updateMany({
    where: { tenantId, id: conversationId },
    data: { slaLevel: 'NONE' },
  });
  await recordAudit(tx, {
    data: {
      type: 'HUMAN_SLA_CLEARED',
      tenantId,
      resourceId: conversationId,
      userId: actorId ?? null,
      changes: {
        cycleIds: cycles.map((c) => c.id),
        claimed,
        source: actorId ? 'human-handoff' : 'human-sla-worker',
      },
    },
  });
  return true;
}
export async function processHumanSlaJob(
  client: PrismaClient,
  input: unknown,
): Promise<HumanSlaNotice | null> {
  const payload = parseHumanSlaPayload(input);
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.$transaction(
        async (tx) => {
          const job = await tx.humanSlaJob.findFirst({
            where: { id: payload.jobId, tenantId: payload.tenantId },
            include: { cycle: true },
          });
          if (!job || job.processedAt) return null;
          // Same write lock as claim. A stale job can never attach itself to a new cycle.
          const [conversation] = await tx.conversation.updateManyAndReturn({
            where: { id: job.cycle.conversationId, tenantId: payload.tenantId },
            data: { updatedAt: new Date() },
            select: {
              id: true,
              status: true,
              handoffRequestedAt: true,
              slaLevel: true,
            },
          });
          const now = await databaseNow(tx);
          const cycle = await tx.humanSlaCycle.findFirstOrThrow({
            where: { id: job.cycleId, tenantId: payload.tenantId },
          });
          const rule = await tx.humanSlaRule.findFirst({
            where: {
              id: cycle.ruleId,
              tenantId: payload.tenantId,
              active: true,
              tenant: { status: 'ACTIVE' },
            },
            select: { id: true },
          });
          if (
            !conversation ||
            cycle.endedAt ||
            !rule ||
            conversation.status !== 'NEEDS_HUMAN' ||
            +conversation.handoffRequestedAt! !== +cycle.requestedAt
          ) {
            const cleared = await closeHumanSlaCycle(
              tx,
              payload.tenantId,
              cycle.conversationId,
              now,
            );
            await tx.humanSlaJob.updateMany({
              where: {
                id: job.id,
                tenantId: payload.tenantId,
                processedAt: null,
              },
              data: { processedAt: now },
            });
            return cleared
              ? {
                  tenantId: payload.tenantId,
                  conversationId: cycle.conversationId,
                }
              : null;
          }
          if (job.dueAt > now) return null;
          const level = resolveHumanSlaLevel(cycle.requestedAt, now, {
            ...cycle,
            active: true,
          });
          await tx.humanSlaJob.updateMany({
            where: {
              tenantId: payload.tenantId,
              cycleId: cycle.id,
              dueAt: { lte: now },
              processedAt: null,
            },
            data: { processedAt: now },
          });
          if (
            humanSlaLevels.indexOf(level) <=
            humanSlaLevels.indexOf(conversation.slaLevel)
          )
            return null;
          const schedule = humanSlaSchedule(cycle.requestedAt, {
            ...cycle,
            active: true,
          });
          const dueAt = schedule.find((entry) => entry.level === level)!.dueAt;
          await tx.conversation.updateMany({
            where: {
              id: conversation.id,
              tenantId: payload.tenantId,
              status: 'NEEDS_HUMAN',
            },
            data: { slaLevel: level },
          });
          await recordAudit(tx, {
            data: {
              tenantId: payload.tenantId,
              resourceId: conversation.id,
              type:
                level === 'EXTERNAL'
                  ? 'HUMAN_SLA_EXTERNAL_ALERT_REQUIRED'
                  : level === 'SECOND'
                    ? 'HUMAN_SLA_SECOND_ALERT'
                    : 'HUMAN_SLA_FIRST_ALERT',
              changes: {
                cycleId: cycle.id,
                level,
                previousLevel: conversation.slaLevel,
                requestedAt: cycle.requestedAt.toISOString(),
                dueAt: dueAt.toISOString(),
                triggeredAt: now.toISOString(),
                source: 'human-sla-worker',
                externalSent: false,
              },
            },
          });
          return {
            tenantId: payload.tenantId,
            conversationId: conversation.id,
          };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2034' &&
        attempt < 3
      )
        continue;
      throw error;
    }
  }
}
