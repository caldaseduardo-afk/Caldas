import { recordAutomationAudit as recordAudit } from './audit';
import { createHash, randomUUID } from 'node:crypto';
import {
  resolveNotificationExecution,
  resolveNotificationSchedule,
  resolveRetrySchedule,
  type NotificationRuleData,
} from '@atendente/domain';
import type { Prisma, PrismaClient } from './generated/prisma/client';
import { databaseNow } from './hold-expiration';
import { startHumanSlaCycle } from './human-sla';

const eligible = {
  CONFIRMATION: ['PENDING_CONFIRMATION'],
  REMINDER: ['PENDING_CONFIRMATION', 'CONFIRMED'],
} as const;
const finalAppointments = [
  'CANCELLED',
  'RESCHEDULED',
  'COMPLETED',
  'NO_SHOW',
  'CHECKED_IN',
] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha = /^[0-9a-f]{64}$/;

export interface NotificationJobPayload {
  tenantId: string;
  appointmentId: string;
  notificationRuleId: string;
  attemptId: string;
  cycleKey: string;
  attemptNumber: number;
  correlationId: string;
}

export function parseNotificationPayload(
  input: unknown,
): NotificationJobPayload {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Job de notificação inválido.');
  const row = input as Record<string, unknown>;
  const keys = [
    'tenantId',
    'appointmentId',
    'notificationRuleId',
    'attemptId',
    'cycleKey',
    'attemptNumber',
    'correlationId',
  ];
  if (
    Object.keys(row).length !== keys.length ||
    !keys.every((key) => key in row) ||
    ![
      row.tenantId,
      row.appointmentId,
      row.notificationRuleId,
      row.attemptId,
      row.correlationId,
    ].every((value) => typeof value === 'string' && uuid.test(value)) ||
    typeof row.cycleKey !== 'string' ||
    !sha.test(row.cycleKey) ||
    !Number.isInteger(row.attemptNumber) ||
    Number(row.attemptNumber) < 1
  )
    throw new Error('Job de notificação inválido.');
  return row as unknown as NotificationJobPayload;
}

type Rule = NotificationRuleData & { id: string; updatedAt: Date };
type AppointmentCycle = { id: string; startAt: Date };
export function notificationCycleKey(
  appointment: AppointmentCycle,
  rule: Rule,
) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        appointmentId: appointment.id,
        startAt: appointment.startAt.toISOString(),
        ruleId: rule.id,
        ruleUpdatedAt: rule.updatedAt.toISOString(),
        type: rule.type,
        offsetMinutes: rule.offsetMinutes,
        allowedStartTime: rule.allowedStartTime.toISOString(),
        allowedEndTime: rule.allowedEndTime.toISOString(),
        allowedWeekdays: rule.allowedWeekdays,
        outsideWindowPolicy: rule.outsideWindowPolicy,
        retryEnabled: rule.retryEnabled,
        retryAfterMinutes: rule.retryAfterMinutes,
        maxAttempts: rule.maxAttempts,
        minimumTimeBeforeAppointment: rule.minimumTimeBeforeAppointment,
        actionIfNoResponse: rule.actionIfNoResponse,
        active: rule.active,
      }),
    )
    .digest('hex');
}

const appointmentGraph = {
  tenant: { select: { status: true, timezone: true } },
  unit: { select: { name: true, timezoneOverride: true } },
  patient: { select: { name: true } },
  service: { select: { name: true } },
  provider: { select: { name: true } },
} as const;

async function serializable<T>(
  client: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.$transaction(fn, { isolationLevel: 'Serializable' });
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : '';
      if (['P2034', 'P2002'].includes(code) && attempt < 4) continue;
      throw error;
    }
  }
}

export async function scheduleAppointmentNotifications(
  client: PrismaClient,
  tenantId: string,
  appointmentId: string,
) {
  if (!uuid.test(tenantId) || !uuid.test(appointmentId))
    throw new Error('Contexto de notificação inválido.');
  return serializable(client, async (tx) => {
    const appointment = await tx.appointment.findFirst({
      where: { tenantId, id: appointmentId, tenant: { status: 'ACTIVE' } },
      include: appointmentGraph,
    });
    if (
      !appointment ||
      finalAppointments.includes(
        appointment.status as (typeof finalAppointments)[number],
      )
    )
      return [];
    const rules = await tx.notificationRule.findMany({
      where: { tenantId, active: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const created = [];
    for (const rule of rules) {
      if (
        !(eligible[rule.type] as readonly string[]).includes(appointment.status)
      )
        continue;
      const timezone =
        appointment.unit.timezoneOverride ?? appointment.tenant.timezone;
      const decision = resolveNotificationSchedule(
        appointment.startAt,
        timezone,
        rule,
      );
      if (decision.decision === 'SKIP') continue;
      const cycleKey = notificationCycleKey(appointment, rule);
      await tx.notificationAttempt.updateMany({
        where: {
          tenantId,
          appointmentId,
          notificationRuleId: rule.id,
          status: 'SCHEDULED',
          cycleKey: { not: cycleKey },
        },
        data: {
          status: 'CANCELLED',
          completedAt: await databaseNow(tx),
          outcome: 'OBSOLETE_CYCLE',
        },
      });
      const row = await tx.notificationAttempt.upsert({
        where: {
          tenantId_appointmentId_notificationRuleId_cycleKey_attemptNumber: {
            tenantId,
            appointmentId,
            notificationRuleId: rule.id,
            cycleKey,
            attemptNumber: 1,
          },
        },
        create: {
          tenantId,
          appointmentId,
          notificationRuleId: rule.id,
          type: rule.type,
          cycleKey,
          attemptNumber: 1,
          scheduledAt: new Date(decision.scheduledAt),
          nextDispatchAt: new Date(decision.scheduledAt),
          correlationId: randomUUID(),
        },
        update: {},
      });
      created.push(row);
    }
    return created;
  });
}

export async function reconcileFutureNotificationJobs(
  client: PrismaClient,
  horizonDays = 30,
  batchSize = 200,
) {
  if (
    !Number.isInteger(horizonDays) ||
    horizonDays < 1 ||
    horizonDays > 366 ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 1000
  )
    throw new Error('Configuração de reconciliation inválida.');
  await syncNotificationAttempts(client);
  const now = await databaseNow(client),
    horizon = new Date(+now + horizonDays * 86400000);
  await client.notificationAttempt.updateMany({
    where: {
      status: 'SCHEDULED',
      OR: [
        {
          type: 'CONFIRMATION',
          appointment: { status: { not: 'PENDING_CONFIRMATION' } },
        },
        {
          type: 'REMINDER',
          appointment: {
            status: { notIn: ['PENDING_CONFIRMATION', 'CONFIRMED'] },
          },
        },
        { appointment: { tenant: { status: { not: 'ACTIVE' } } } },
        { notificationRule: { active: false } },
      ],
    },
    data: { status: 'CANCELLED', completedAt: now, outcome: 'OBSOLETE_STATE' },
  });
  let attempts = 0,
    appointments = 0,
    cursor: string | undefined;
  for (;;) {
    const page = await client.appointment.findMany({
      where: {
        status: { in: ['PENDING_CONFIRMATION', 'CONFIRMED'] },
        startAt: { gt: now, lte: horizon },
        tenant: { status: 'ACTIVE' },
      },
      select: { id: true, tenantId: true },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const row of page)
      attempts += (
        await scheduleAppointmentNotifications(client, row.tenantId, row.id)
      ).length;
    appointments += page.length;
    if (page.length < batchSize) break;
    cursor = page.at(-1)!.id;
  }
  return { appointments, attempts };
}

function formatAppointment(
  appointment: {
    startAt: Date;
    patient: { name: string };
    service: { name: string };
    provider: { name: string };
    unit: { name: string };
  },
  timezone: string,
  type: 'CONFIRMATION' | 'REMINDER',
) {
  const when = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(appointment.startAt);
  return type === 'CONFIRMATION'
    ? `Olá, ${appointment.patient.name}. Você confirma sua consulta de ${appointment.service.name} com ${appointment.provider.name}, na unidade ${appointment.unit.name}, em ${when}?`
    : `Olá, ${appointment.patient.name}. Lembramos sua consulta de ${appointment.service.name} com ${appointment.provider.name}, na unidade ${appointment.unit.name}, em ${when}.`;
}

export async function processNotificationJob(
  client: PrismaClient,
  input: unknown,
) {
  const payload = parseNotificationPayload(input);
  return serializable(client, async (tx) => {
    const now = await databaseNow(tx);
    const attempt = await tx.notificationAttempt.findFirst({
      where: {
        id: payload.attemptId,
        tenantId: payload.tenantId,
        appointmentId: payload.appointmentId,
        notificationRuleId: payload.notificationRuleId,
        cycleKey: payload.cycleKey,
        attemptNumber: payload.attemptNumber,
      },
      include: {
        appointment: { include: appointmentGraph },
        notificationRule: true,
        message: true,
      },
    });
    if (!attempt) throw new Error('Contexto de notificação inválido.');
    if (attempt.status !== 'SCHEDULED')
      return { outcome: 'DUPLICATE', attemptId: attempt.id };
    const appointment = attempt.appointment,
      rule = attempt.notificationRule;
    const skip = async (
      code: string,
      status: 'SKIPPED' | 'CANCELLED' = 'SKIPPED',
    ) => {
      await tx.notificationAttempt.update({
        where: { id: attempt.id },
        data: { status, completedAt: now, errorCode: code, outcome: code },
      });
      return { outcome: code, attemptId: attempt.id };
    };
    if (appointment.tenant.status !== 'ACTIVE')
      return skip('TENANT_INACTIVE', 'CANCELLED');
    if (notificationCycleKey(appointment, rule) !== attempt.cycleKey)
      return skip('OBSOLETE_CYCLE', 'CANCELLED');
    if (
      !rule.active ||
      !(eligible[rule.type] as readonly string[]).includes(appointment.status)
    )
      return skip('APPOINTMENT_INELIGIBLE');
    const timezone =
      appointment.unit.timezoneOverride ?? appointment.tenant.timezone;
    const execution = resolveNotificationExecution(
      now,
      appointment.startAt,
      timezone,
      rule,
    );
    if (execution.decision === 'SKIP') return skip(execution.reason);
    const executableAt = new Date(execution.scheduledAt);
    if (+executableAt > +now) {
      await tx.notificationAttempt.update({
        where: { id: attempt.id },
        data: {
          scheduledAt: executableAt,
          nextDispatchAt: executableAt,
          outcome: 'RECALCULATED',
        },
      });
      return { outcome: 'RESCHEDULED', attemptId: attempt.id };
    }
    if (!appointment.contactId) return skip('CONTACT_UNAVAILABLE');
    const conversation = await tx.conversation.findFirst({
      where: {
        tenantId: payload.tenantId,
        contactId: appointment.contactId,
        status: { in: ['AI_ACTIVE', 'WAITING_PATIENT'] },
        integration: { status: { in: ['ACTIVE', 'DEGRADED'] } },
        contact: { status: 'ACTIVE' },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    });
    const channel = await tx.contactChannel.findFirst({
      where: {
        tenantId: payload.tenantId,
        contactId: appointment.contactId,
        type: 'WHATSAPP',
        contact: { status: 'ACTIVE' },
      },
      orderBy: [{ primary: 'desc' }, { createdAt: 'asc' }],
    });
    if (!conversation?.integrationId || !channel)
      return skip('DESTINATION_UNAVAILABLE');
    const claimed = await tx.notificationAttempt.updateMany({
      where: {
        id: attempt.id,
        tenantId: payload.tenantId,
        status: 'SCHEDULED',
        messageId: null,
      },
      data: { status: 'PROCESSING', startedAt: now, nextDispatchAt: now },
    });
    if (claimed.count !== 1)
      return { outcome: 'DUPLICATE', attemptId: attempt.id };
    const message = await tx.message.create({
      data: {
        tenantId: payload.tenantId,
        conversationId: conversation.id,
        integrationId: conversation.integrationId,
        channel: 'WHATSAPP',
        senderType: 'AI',
        messageType: 'TEXT',
        content: formatAppointment(appointment, timezone, rule.type),
        recipientAddress: channel.address,
        deliveryStatus: 'PENDING',
        nextAttemptAt: now,
      },
    });
    await tx.notificationAttempt.update({
      where: { id: attempt.id },
      data: { messageId: message.id },
    });
    await recordAudit(tx, {
      data: {
        tenantId: payload.tenantId,
        resourceId: message.id,
        type: 'MESSAGE_SEND_REQUESTED',
        changes: {
          conversationId: conversation.id,
          source: 'appointment-automation',
          notificationAttemptId: attempt.id,
        },
      },
    });
    return {
      outcome: 'OUTBOXED',
      attemptId: attempt.id,
      messageId: message.id,
    };
  });
}

async function applyNoResponse(
  tx: Prisma.TransactionClient,
  attempt: {
    id: string;
    tenantId: string;
    appointmentId: string;
    messageId: string | null;
    correlationId: string;
    notificationRule: { actionIfNoResponse: string };
    appointment: { status: string; contactId: string | null };
  },
  now: Date,
) {
  const claimed = await tx.notificationAttempt.updateMany({
    where: { id: attempt.id, tenantId: attempt.tenantId, noResponseAt: null },
    data: {
      noResponseAt: now,
      completedAt: now,
      outcome: `NO_RESPONSE_${attempt.notificationRule.actionIfNoResponse}`,
    },
  });
  if (!claimed.count || attempt.appointment.status === 'CONFIRMED') return;
  if (
    attempt.notificationRule.actionIfNoResponse !== 'NEEDS_HUMAN' ||
    !attempt.appointment.contactId
  )
    return;
  const message = attempt.messageId
    ? await tx.message.findFirst({
        where: { tenantId: attempt.tenantId, id: attempt.messageId },
        select: { conversationId: true },
      })
    : null;
  if (!message) return;
  const conversation = await tx.conversation.findFirst({
    where: { tenantId: attempt.tenantId, id: message.conversationId },
  });
  if (
    !conversation ||
    !['AI_ACTIVE', 'WAITING_PATIENT', 'NEEDS_HUMAN'].includes(
      conversation.status,
    )
  )
    return;
  if (conversation.status !== 'NEEDS_HUMAN') {
    await tx.conversation.update({
      where: { id: conversation.id },
      data: {
        status: 'NEEDS_HUMAN',
        handoffReason: 'OTHER',
        handoffRequestedAt: now,
        assignedUserId: null,
        assignedAt: null,
        slaLevel: 'NONE',
      },
    });
    await recordAudit(tx, {
      data: {
        tenantId: attempt.tenantId,
        resourceId: conversation.id,
        type: 'HUMAN_HANDOFF_REQUESTED',
        correlationId: attempt.correlationId,
        changes: {
          from: conversation.status,
          to: 'NEEDS_HUMAN',
          previousAssignee: conversation.assignedUserId,
          newAssignee: null,
          source: 'notification-no-response',
          appointmentId: attempt.appointmentId,
        },
      },
    });
  }
  await startHumanSlaCycle(
    tx,
    attempt.tenantId,
    conversation.id,
    conversation.handoffRequestedAt ?? now,
  );
}

export async function syncNotificationAttempts(client: PrismaClient) {
  return serializable(client, async (tx) => {
    const now = await databaseNow(tx);
    const rows = await tx.notificationAttempt.findMany({
      where: { status: { in: ['PROCESSING', 'SENT'] }, noResponseAt: null },
      include: { message: true, notificationRule: true, appointment: true },
      orderBy: { updatedAt: 'asc' },
      take: 200,
    });
    let changed = 0;
    for (const row of rows) {
      if (row.status === 'PROCESSING') {
        if (!row.message) continue;
        if (
          ['SENT', 'DELIVERED', 'READ'].includes(row.message.deliveryStatus)
        ) {
          const sentAt = row.message.sentAt ?? now;
          await tx.notificationAttempt.update({
            where: { id: row.id },
            data: {
              status: 'SENT',
              sentAt,
              providerMessageId: row.message.providerMessageId,
              errorCode: null,
            },
          });
          row.status = 'SENT';
          row.sentAt = sentAt;
          changed++;
        } else if (row.message.deliveryStatus === 'FAILED') {
          await tx.notificationAttempt.update({
            where: { id: row.id },
            data: {
              status: 'FAILED',
              completedAt: now,
              errorCode: row.message.errorCode ?? 'DELIVERY_FAILED',
              outcome: 'DELIVERY_FAILED',
            },
          });
          changed++;
          continue;
        } else continue;
      }
      if (row.type === 'REMINDER') {
        await tx.notificationAttempt.update({
          where: { id: row.id },
          data: {
            noResponseAt: now,
            completedAt: now,
            outcome: 'REMINDER_SENT',
          },
        });
        continue;
      }
      if (row.appointment.status === 'CONFIRMED') {
        await tx.notificationAttempt.update({
          where: { id: row.id },
          data: {
            noResponseAt: now,
            completedAt: now,
            outcome: 'RESPONSE_RECEIVED',
          },
        });
        continue;
      }
      const sentMinute = new Date(
          Math.floor(+(row.sentAt ?? now) / 60000) * 60000,
        ),
        nextNumber = row.attemptNumber + 1;
      const timezone = await tx.unit.findFirstOrThrow({
        where: { tenantId: row.tenantId, id: row.appointment.unitId },
        select: {
          timezoneOverride: true,
          tenant: { select: { timezone: true } },
        },
      });
      const decision = resolveRetrySchedule(
        sentMinute,
        row.appointment.startAt,
        timezone.timezoneOverride ?? timezone.tenant.timezone,
        row.notificationRule,
        nextNumber,
      );
      if (decision.decision === 'SCHEDULE') {
        await tx.notificationAttempt.upsert({
          where: {
            tenantId_appointmentId_notificationRuleId_cycleKey_attemptNumber: {
              tenantId: row.tenantId,
              appointmentId: row.appointmentId,
              notificationRuleId: row.notificationRuleId,
              cycleKey: row.cycleKey,
              attemptNumber: nextNumber,
            },
          },
          create: {
            tenantId: row.tenantId,
            appointmentId: row.appointmentId,
            notificationRuleId: row.notificationRuleId,
            type: 'CONFIRMATION',
            cycleKey: row.cycleKey,
            attemptNumber: nextNumber,
            scheduledAt: new Date(decision.scheduledAt),
            nextDispatchAt: new Date(decision.scheduledAt),
            correlationId: randomUUID(),
          },
          update: {},
        });
        await tx.notificationAttempt.update({
          where: { id: row.id },
          data: {
            noResponseAt: now,
            completedAt: now,
            outcome: 'RETRY_SCHEDULED',
          },
        });
      } else await applyNoResponse(tx, row, now);
    }
    return changed;
  });
}

export function notificationJobId(payload: NotificationJobPayload) {
  return `notification-${payload.tenantId}-${payload.appointmentId}-${payload.notificationRuleId}-${payload.cycleKey}-${payload.attemptNumber}`;
}
export function notificationPayloadFromAttempt(row: {
  id: string;
  tenantId: string;
  appointmentId: string;
  notificationRuleId: string;
  cycleKey: string;
  attemptNumber: number;
  correlationId: string;
}): NotificationJobPayload {
  return {
    tenantId: row.tenantId,
    appointmentId: row.appointmentId,
    notificationRuleId: row.notificationRuleId,
    attemptId: row.id,
    cycleKey: row.cycleKey,
    attemptNumber: row.attemptNumber,
    correlationId: row.correlationId,
  };
}

export function notificationLog(
  event: string,
  data: Record<string, string | number | boolean | null | undefined>,
) {
  console.info(
    JSON.stringify({ event, component: 'appointment-notifications', ...data }),
  );
}
