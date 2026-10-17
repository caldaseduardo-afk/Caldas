import { Queue, Worker } from 'bullmq';
import type { PrismaClient } from './generated/prisma/client';
import { humanSlaConnection } from './human-sla-queue';
import { databaseNow } from './hold-expiration';
import {
  notificationJobId,
  notificationLog,
  notificationPayloadFromAttempt,
  processNotificationJob,
  reconcileFutureNotificationJobs,
  syncNotificationAttempts,
} from './notification-automation';

export const NOTIFICATION_QUEUE = 'appointment-notifications';

export function workerConcurrency(value: string | undefined) {
  const parsed = Number(value ?? '4');
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 64)
    throw new Error('WORKER_CONCURRENCY inválido.');
  return parsed;
}
export function reconciliationHorizon(value: string | undefined) {
  const parsed = Number(value ?? '30');
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 366)
    throw new Error('NOTIFICATION_RECONCILIATION_HORIZON_DAYS inválido.');
  return parsed;
}

export function createNotificationQueue(redis: string) {
  const queue = new Queue(NOTIFICATION_QUEUE, {
    connection: {
      ...humanSlaConnection(redis),
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 86400, count: 10000 },
      removeOnFail: { age: 604800, count: 20000 },
    },
  });
  queue.on('error', () => console.error('Fila de automações indisponível.'));
  return queue;
}

export async function dispatchNotificationJobs(
  client: PrismaClient,
  queue: ReturnType<typeof createNotificationQueue>,
  horizonDays = 30,
) {
  await syncNotificationAttempts(client);
  const now = await databaseNow(client),
    horizon = new Date(+now + horizonDays * 86400000);
  let count = 0,
    enqueued = 0,
    cursor: string | undefined;
  for (;;) {
    const rows = await client.notificationAttempt.findMany({
      where: { status: 'SCHEDULED', nextDispatchAt: { lte: horizon } },
      orderBy: [{ nextDispatchAt: 'asc' }, { id: 'asc' }],
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const row of rows) {
      const payload = notificationPayloadFromAttempt(row),
        jobId = notificationJobId(payload),
        old = await queue.getJob(jobId);
      if (old) {
        const state = await old.getState();
        if (state === 'failed') {
          await old.retry();
          enqueued++;
          continue;
        } else if (state === 'completed') await old.remove();
        else continue;
      }
      await queue.add(
        row.type === 'CONFIRMATION'
          ? 'notification:confirmation'
          : 'notification:reminder',
        payload,
        { jobId, delay: Math.max(0, +row.nextDispatchAt - Date.now()) },
      );
      enqueued++;
    }
    count += rows.length;
    if (rows.length < 500) break;
    cursor = rows.at(-1)!.id;
  }
  if (enqueued)
    notificationLog('jobs_enqueued', { count: enqueued, scanned: count });
  return count;
}

export function createNotificationWorker(
  client: PrismaClient,
  redis: string,
  concurrency = 4,
) {
  const worker = new Worker(
    NOTIFICATION_QUEUE,
    async (job) => {
      if (
        !['notification:confirmation', 'notification:reminder'].includes(
          job.name,
        )
      )
        throw new Error('Tipo de job inválido.');
      const started = Date.now();
      const result = await processNotificationJob(client, job.data);
      notificationLog('job_completed', {
        jobId: job.id,
        type: job.name,
        tenantId: String(job.data?.tenantId ?? ''),
        appointmentId: String(job.data?.appointmentId ?? ''),
        attempt: Number(job.data?.attemptNumber ?? 0),
        scheduledAt: new Date(
          job.timestamp + Number(job.opts.delay ?? 0),
        ).toISOString(),
        startedAt: new Date(started).toISOString(),
        outcome: result.outcome,
        durationMs: Date.now() - started,
      });
      return result;
    },
    { connection: humanSlaConnection(redis), concurrency },
  );
  worker.on('error', () => console.error('Worker de automações indisponível.'));
  worker.on('failed', (job, error) =>
    notificationLog('job_failed', {
      jobId: job?.id,
      type: job?.name,
      errorCode: error.name,
      retry: (job?.attemptsMade ?? 0) < (job?.opts.attempts ?? 1),
    }),
  );
  return worker;
}

export async function reconcileAndDispatchNotifications(
  client: PrismaClient,
  queue: ReturnType<typeof createNotificationQueue>,
  horizonDays = 30,
) {
  const result = await reconcileFutureNotificationJobs(client, horizonDays);
  const enqueued = await dispatchNotificationJobs(client, queue, horizonDays);
  return { ...result, enqueued };
}
