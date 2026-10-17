import { Queue, Worker } from 'bullmq';
import type { CalendarProvider } from '@atendente/domain';
import type { PrismaClient } from './generated/prisma/client';
import { humanSlaConnection } from './human-sla-queue';
import {
  calendarSyncJobId,
  processCalendarSync,
  reconcileCalendarSync,
  type CalendarSyncPayload,
} from './calendar-sync';

export const CALENDAR_SYNC_QUEUE = 'calendar-sync';

export function calendarReconciliationHorizon(value: string | undefined) {
  const parsed = Number(value ?? '180');
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 730)
    throw new Error('CALENDAR_RECONCILIATION_HORIZON_DAYS inválido.');
  return parsed;
}

export function createCalendarSyncQueue(redis: string) {
  const queue = new Queue<CalendarSyncPayload>(CALENDAR_SYNC_QUEUE, {
    connection: {
      ...humanSlaConnection(redis),
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    },
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 86_400, count: 10_000 },
      removeOnFail: { age: 604_800, count: 20_000 },
    },
  });
  queue.on('error', () => console.error('Fila de calendário indisponível.'));
  return queue;
}

export async function dispatchCalendarSync(
  client: PrismaClient,
  queue: ReturnType<typeof createCalendarSyncQueue>,
  horizonDays = 180,
) {
  const payloads = await reconcileCalendarSync(client, horizonDays);
  let enqueued = 0;
  for (const payload of payloads) {
    const jobId = calendarSyncJobId(payload);
    const old = await queue.getJob(jobId);
    if (old) {
      const state = await old.getState();
      if (state === 'failed') {
        await old.retry();
        enqueued++;
      } else if (state === 'completed') {
        await old.remove();
        await queue.add('calendar:sync', payload, { jobId });
        enqueued++;
      }
      continue;
    }
    await queue.add('calendar:sync', payload, { jobId });
    enqueued++;
  }
  return { scanned: payloads.length, enqueued };
}

export function createCalendarSyncWorker(
  client: PrismaClient,
  redis: string,
  provider: CalendarProvider,
  concurrency = 4,
) {
  const worker = new Worker<CalendarSyncPayload>(
    CALENDAR_SYNC_QUEUE,
    async (job) => {
      const started = Date.now();
      const result = await processCalendarSync(client, provider, job.data);
      console.info(
        JSON.stringify({
          event: 'calendar_sync_completed',
          jobId: job.id,
          tenantId: job.data.tenantId,
          appointmentId: job.data.appointmentId,
          revision: job.data.revision,
          outcome: result.outcome,
          durationMs: Date.now() - started,
        }),
      );
      return result;
    },
    { connection: humanSlaConnection(redis), concurrency },
  );
  worker.on('error', () => console.error('Worker de calendário indisponível.'));
  worker.on('failed', (job, error) =>
    console.error(
      JSON.stringify({
        event: 'calendar_sync_failed',
        jobId: job?.id,
        tenantId: job?.data.tenantId,
        appointmentId: job?.data.appointmentId,
        errorCode: error.name,
        retry: (job?.attemptsMade ?? 0) < (job?.opts.attempts ?? 1),
      }),
    ),
  );
  return worker;
}
