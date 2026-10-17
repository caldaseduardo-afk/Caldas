import { auditActorContext } from './audit';
import { recordAudit } from './audit';
import { randomUUID } from 'node:crypto';
import {
  CalendarProviderError,
  type CalendarProvider,
  type CalendarEventInput,
} from '@atendente/domain';
import type { Prisma, PrismaClient } from './generated/prisma/client';
import { databaseNow } from './hold-expiration';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const terminal = ['CANCELLED', 'RESCHEDULED'] as const;
const retryLimit = 5;

export async function calendarSyncCreateData(
  tx: Prisma.TransactionClient,
  tenantId: string,
) {
  const integration = await tx.calendarIntegration.findFirst({
    where: { tenantId, status: 'ACTIVE', provider: 'GOOGLE_CALENDAR' },
    select: { id: true },
  });
  return integration
    ? {
        calendarProvider: 'GOOGLE_CALENDAR',
        syncStatus: 'PENDING' as const,
        calendarSyncRevision: 1,
      }
    : {
        calendarProvider: null,
        syncStatus: 'NOT_REQUIRED' as const,
        calendarSyncRevision: 0,
      };
}

export async function recordCalendarSyncIntent(
  tx: Prisma.TransactionClient,
  row: {
    id: string;
    tenantId: string;
    calendarSyncRevision: number;
    status: string;
  },
) {
  if (row.calendarSyncRevision < 1) return null;
  return tx.calendarSyncAttempt.upsert({
    where: {
      tenantId_appointmentId_revision: {
        tenantId: row.tenantId,
        appointmentId: row.id,
        revision: row.calendarSyncRevision,
      },
    },
    create: {
      tenantId: row.tenantId,
      appointmentId: row.id,
      revision: row.calendarSyncRevision,
      operation: terminal.includes(row.status as (typeof terminal)[number])
        ? 'CANCEL'
        : 'UPSERT',
      correlationId: auditActorContext.getStore()?.correlationId ?? randomUUID(),
    },
    update: {},
  });
}

export interface CalendarSyncPayload {
  tenantId: string;
  appointmentId: string;
  revision: number;
}

export function parseCalendarSyncPayload(value: unknown): CalendarSyncPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Job de calendário inválido.');
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== 3 ||
    !uuid.test(String(row.tenantId ?? '')) ||
    !uuid.test(String(row.appointmentId ?? '')) ||
    !Number.isInteger(row.revision) ||
    Number(row.revision) < 1
  )
    throw new Error('Job de calendário inválido.');
  return row as unknown as CalendarSyncPayload;
}

export function calendarSyncJobId(payload: CalendarSyncPayload) {
  return `calendar-${payload.tenantId}-${payload.appointmentId}-${payload.revision}`;
}

const graph = {
  tenant: { select: { timezone: true, status: true } },
  unit: { select: { name: true, address: true, timezoneOverride: true } },
  service: { select: { name: true } },
} as const;

function eventInput(appointment: {
  id: string;
  startAt: Date;
  endAt: Date;
  tenant: { timezone: string };
  unit: { name: string; address: string; timezoneOverride: string | null };
  service: { name: string };
}): CalendarEventInput {
  return {
    appointmentId: appointment.id,
    title: `Consulta - ${appointment.service.name}`,
    location: `${appointment.unit.name} — ${appointment.unit.address}`,
    startAt: appointment.startAt.toISOString(),
    endAt: appointment.endAt.toISOString(),
    timezone: appointment.unit.timezoneOverride ?? appointment.tenant.timezone,
  };
}

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
      if (['P2034', 'P2002'].includes(code) && attempt < 3) continue;
      throw error;
    }
  }
}

export async function processCalendarSync(
  client: PrismaClient,
  provider: CalendarProvider,
  input: unknown,
) {
  const payload = parseCalendarSyncPayload(input);
  const snapshot = await serializable(client, async (tx) => {
    const attempt = await tx.calendarSyncAttempt.findUnique({
      where: {
        tenantId_appointmentId_revision: {
          tenantId: payload.tenantId,
          appointmentId: payload.appointmentId,
          revision: payload.revision,
        },
      },
    });
    const appointment = await tx.appointment.findFirst({
      where: { tenantId: payload.tenantId, id: payload.appointmentId },
      include: graph,
    });
    const integration = await tx.calendarIntegration.findFirst({
      where: {
        tenantId: payload.tenantId,
        status: 'ACTIVE',
        provider: 'GOOGLE_CALENDAR',
      },
    });
    if (!attempt || !appointment || !integration) return null;
    if (appointment.calendarSyncRevision !== payload.revision) {
      await tx.calendarSyncAttempt.update({
        where: { id: attempt.id },
        data: { status: 'OBSOLETE', completedAt: await databaseNow(tx) },
      });
      return null;
    }
    if (attempt.status === 'SUCCEEDED' || attempt.status === 'PERMANENT_ERROR')
      return null;
    const now = await databaseNow(tx);
    const updated = await tx.calendarSyncAttempt.updateMany({
      where: {
        id: attempt.id,
        OR: [
          { status: { in: ['PENDING', 'RETRYABLE_ERROR'] } },
          {
            status: 'PROCESSING',
            startedAt: { lt: new Date(+now - 60_000) },
          },
        ],
      },
      data: {
        status: 'PROCESSING',
        attemptCount: { increment: 1 },
        startedAt: now,
      },
    });
    if (updated.count !== 1) return null;
    return {
      appointment,
      integration,
      attemptId: attempt.id,
      attemptCount: attempt.attemptCount + 1,
    };
  });
  if (!snapshot) return { outcome: 'SKIPPED' as const };

  const { appointment, integration } = snapshot;
  try {
    let externalEventId = appointment.externalEventId;
    if (terminal.includes(appointment.status as (typeof terminal)[number])) {
      if (!externalEventId)
        externalEventId =
          (await provider.findEventByAppointment(integration, appointment.id))
            ?.eventId ?? null;
      if (externalEventId)
        await provider.cancelEvent(integration, externalEventId);
    } else {
      const inputEvent = eventInput(appointment);
      if (externalEventId) {
        try {
          externalEventId = (
            await provider.updateEvent(integration, externalEventId, inputEvent)
          ).eventId;
        } catch (error) {
          if (!(error instanceof CalendarProviderError && error.notFound))
            throw error;
          externalEventId = null;
        }
      }
      if (!externalEventId)
        externalEventId =
          (await provider.findEventByAppointment(integration, appointment.id))
            ?.eventId ??
          (await provider.createEvent(integration, inputEvent)).eventId;
    }
    await serializable(client, async (tx) => {
      const now = await databaseNow(tx);
      await tx.calendarSyncAttempt.update({
        where: { id: snapshot.attemptId },
        data: { status: 'SUCCEEDED', completedAt: now, errorCode: null },
      });
      const updated = await tx.appointment.updateMany({
        where: {
          tenantId: payload.tenantId,
          id: payload.appointmentId,
          calendarSyncRevision: payload.revision,
        },
        data: {
          externalEventId,
          syncStatus: 'SYNCED',
          calendarSyncAttemptsCount: snapshot.attemptCount,
          calendarSyncErrorCode: null,
          calendarLastSyncedAt: now,
        },
      });
      if (updated.count)
        await recordAudit(tx, {
          data: {
            tenantId: payload.tenantId,
            resourceId: payload.appointmentId,
            type: 'CALENDAR_SYNC_SUCCEEDED',
            changes: {
              revision: payload.revision,
              operation: terminal.includes(appointment.status as never)
                ? 'CANCEL'
                : 'UPSERT',
            },
          },
        });
    });
    return { outcome: 'SYNCED' as const, externalEventId };
  } catch (unknownError) {
    const error =
      unknownError instanceof CalendarProviderError
        ? unknownError
        : new CalendarProviderError('CALENDAR_UNEXPECTED_ERROR', true);
    const retryable = error.retryable && snapshot.attemptCount < retryLimit;
    await serializable(client, async (tx) => {
      const now = await databaseNow(tx);
      await tx.calendarSyncAttempt.update({
        where: { id: snapshot.attemptId },
        data: {
          status: retryable ? 'RETRYABLE_ERROR' : 'PERMANENT_ERROR',
          errorCode: error.code,
          nextAttemptAt: new Date(
            +now + Math.min(300_000, 1000 * 2 ** snapshot.attemptCount),
          ),
          ...(!retryable ? { completedAt: now } : {}),
        },
      });
      const updated = await tx.appointment.updateMany({
        where: {
          tenantId: payload.tenantId,
          id: payload.appointmentId,
          calendarSyncRevision: payload.revision,
        },
        data: {
          syncStatus: 'ERROR',
          calendarSyncAttemptsCount: snapshot.attemptCount,
          calendarSyncErrorCode: error.code,
        },
      });
      if (updated.count)
        await recordAudit(tx, {
          data: {
            tenantId: payload.tenantId,
            resourceId: payload.appointmentId,
            type: 'CALENDAR_SYNC_FAILED',
            changes: {
              revision: payload.revision,
              errorCode: error.code,
              retryable,
            },
          },
        });
    });
    if (retryable) throw error;
    return { outcome: 'ERROR' as const, errorCode: error.code };
  }
}

export async function reconcileCalendarSync(
  client: PrismaClient,
  horizonDays = 180,
  batchSize = 200,
) {
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 730)
    throw new Error('Horizonte de calendário inválido.');
  const now = await databaseNow(client);
  const horizon = new Date(+now + horizonDays * 86_400_000);
  const rows = await client.appointment.findMany({
    where: {
      syncStatus: { in: ['PENDING', 'ERROR'] },
      calendarProvider: 'GOOGLE_CALENDAR',
      calendarSyncRevision: { gt: 0 },
      OR: [
        { startAt: { gte: now, lte: horizon } },
        {
          status: { in: ['CANCELLED', 'RESCHEDULED'] },
          externalEventId: { not: null },
        },
      ],
      tenant: { status: 'ACTIVE', calendarIntegration: { status: 'ACTIVE' } },
    },
    select: {
      id: true,
      tenantId: true,
      status: true,
      calendarSyncRevision: true,
      calendarSyncAttempts: {
        orderBy: { revision: 'desc' },
        take: 1,
        select: { revision: true, status: true, nextAttemptAt: true },
      },
    },
    orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    take: batchSize,
  });
  const eligible = rows.filter((row) => {
    const last = row.calendarSyncAttempts[0];
    return (
      !last ||
      last.revision !== row.calendarSyncRevision ||
      (last.status !== 'PERMANENT_ERROR' &&
        last.status !== 'SUCCEEDED' &&
        (last.status !== 'RETRYABLE_ERROR' || last.nextAttemptAt <= now))
    );
  });
  for (const row of eligible)
    await serializable(client, (tx) => recordCalendarSyncIntent(tx, row));
  return eligible.map((row) => ({
    tenantId: row.tenantId,
    appointmentId: row.id,
    revision: row.calendarSyncRevision,
  }));
}
