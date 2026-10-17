import { Queue, Worker, QueueEvents, type ConnectionOptions } from 'bullmq';
import type { PrismaClient } from './generated/prisma/client';
import { databaseNow } from './hold-expiration';
import {
  processHumanSlaJob,
  type HumanSlaPayload,
  type HumanSlaNotice,
} from './human-sla';
export const HUMAN_SLA_QUEUE = 'human-sla';
export function humanSlaConnection(
  value: string | undefined,
): ConnectionOptions {
  try {
    if (!value) throw new Error();
    const url = new URL(value);
    if (
      !['redis:', 'rediss:'].includes(url.protocol) ||
      url.search ||
      url.hash ||
      !/^\/\d*$/.test(url.pathname || '/')
    )
      throw new Error();
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      db: Number(url.pathname.slice(1) || 0),
      ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
      ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
      maxRetriesPerRequest: null,
      connectTimeout: 5000,
    };
  } catch {
    throw new Error('REDIS_URL inválida ou ausente.');
  }
}
export function createHumanSlaQueue(redisUrl: string) {
  const queue = new Queue<HumanSlaPayload, HumanSlaNotice | null>(
    HUMAN_SLA_QUEUE,
    {
      connection: {
        ...humanSlaConnection(redisUrl),
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      },
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 86400, count: 10000 },
        removeOnFail: { age: 604800, count: 10000 },
      },
    },
  );
  queue.on('error', () => console.error('Conexão da fila SLA indisponível.'));
  return queue;
}
// Indexed outbox, not a scan of conversations. Retry is safe across multiple dispatchers.
export async function dispatchHumanSlaJobs(
  client: PrismaClient,
  queue: ReturnType<typeof createHumanSlaQueue>,
) {
  const now = await databaseNow(client);
  const jobs = await client.humanSlaJob.findMany({
    where: { processedAt: null, nextDispatchAt: { lte: now } },
    orderBy: [{ nextDispatchAt: 'asc' }, { id: 'asc' }],
    take: 100,
  });
  for (const row of jobs) {
    const old = await queue.getJob(row.id);
    if (old) {
      const state = await old.getState();
      if (state === 'failed') await old.retry();
      else if (state === 'completed') await old.remove();
    }
    await queue.add(
      'alert',
      { tenantId: row.tenantId, jobId: row.id },
      { jobId: row.id, delay: Math.max(0, +row.dueAt - +now) },
    );
    await client.humanSlaJob.updateMany({
      where: { id: row.id, tenantId: row.tenantId, processedAt: null },
      data: { nextDispatchAt: new Date(Math.max(+now, +row.dueAt) + 60000) },
    });
  }
  return jobs.length;
}
export function createHumanSlaWorker(client: PrismaClient, redisUrl: string) {
  const worker = new Worker<HumanSlaPayload, HumanSlaNotice | null>(
    HUMAN_SLA_QUEUE,
    async (job) => {
      if (job.name !== 'alert') throw new Error('Tipo de job SLA inválido.');
      return processHumanSlaJob(client, job.data);
    },
    { connection: humanSlaConnection(redisUrl), concurrency: 4 },
  );
  worker.on('error', () => console.error('Worker SLA indisponível.'));
  worker.on('failed', () =>
    console.error('Job SLA falhou; consultar estado operacional da fila.'),
  );
  return worker;
}
export function subscribeHumanSlaUpdates(
  redisUrl: string,
  publish: (notice: HumanSlaNotice) => void,
) {
  const events = new QueueEvents(HUMAN_SLA_QUEUE, {
    connection: humanSlaConnection(redisUrl),
  });
  events.on('error', () => console.error('Eventos da fila SLA indisponíveis.'));
  events.on('completed', ({ returnvalue }) => {
    try {
      const value: unknown =
        typeof returnvalue === 'string' ? JSON.parse(returnvalue) : returnvalue;
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>,
        uuid = /^[0-9a-f-]{36}$/i;
      if (
        Object.keys(record).length === 2 &&
        typeof record.tenantId === 'string' &&
        uuid.test(record.tenantId) &&
        typeof record.conversationId === 'string' &&
        uuid.test(record.conversationId)
      )
        publish({
          tenantId: record.tenantId,
          conversationId: record.conversationId,
        });
    } catch {
      /* Never forward raw queue payloads. REST validates resource access again. */
    }
  });
  return events;
}
