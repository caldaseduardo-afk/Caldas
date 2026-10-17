import { Queue, Worker, QueueEvents } from 'bullmq';
import type { PrismaClient } from './generated/prisma/client';
import type { MessagingProvider } from '@atendente/domain';
import { humanSlaConnection } from './human-sla-queue';
import { deliverMessage, type MessagingNotice } from './messaging-delivery';
import { databaseNow } from './hold-expiration';
const queueName = 'whatsapp-delivery';
export function createMessagingQueue(redis: string) {
  const queue = new Queue<
    { tenantId: string; messageId: string },
    MessagingNotice | null
  >(queueName, {
    connection: {
      ...humanSlaConnection(redis),
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 86400, count: 10000 },
      removeOnFail: { age: 604800, count: 10000 },
    },
  });
  queue.on('error', () => console.error('Fila de mensagens indisponível.'));
  return queue;
}
export async function dispatchMessages(
  client: PrismaClient,
  queue: ReturnType<typeof createMessagingQueue>,
) {
  const now = await databaseNow(client);
  const rows = await client.message.findMany({
    where: {
      deliveryStatus: { in: ['PENDING', 'SENDING'] },
      nextAttemptAt: { lte: now },
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
    take: 100,
  });
  for (const row of rows) {
    const jobId = `${row.id}-${row.sendAttempts}`;
    const old = await queue.getJob(jobId);
    if (old) {
      const state = await old.getState();
      if (state === 'failed') await old.retry();
      else if (state === 'completed') await old.remove();
    }
    await queue.add(
      'send',
      { tenantId: row.tenantId, messageId: row.id },
      { jobId },
    );
  }
  return rows.length;
}
export function createMessagingWorker(
  client: PrismaClient,
  redis: string,
  provider: MessagingProvider,
) {
  const worker = new Worker(
    queueName,
    async (job) => {
      if (job.name !== 'send') throw new Error('Tipo de job inválido.');
      return deliverMessage(client, job.data, provider);
    },
    { connection: humanSlaConnection(redis), concurrency: 4 },
  );
  worker.on('error', () => console.error('Worker de mensagens indisponível.'));
  worker.on('failed', () =>
    console.error('Job de mensagem falhou; consultar estado persistido.'),
  );
  return worker;
}
export function subscribeMessagingUpdates(
  redis: string,
  publish: (notice: MessagingNotice) => void,
) {
  const events = new QueueEvents(queueName, {
    connection: humanSlaConnection(redis),
  });
  events.on('error', () =>
    console.error('Eventos de mensagens indisponíveis.'),
  );
  events.on('completed', ({ returnvalue }) => {
    try {
      const value: unknown =
        typeof returnvalue === 'string' ? JSON.parse(returnvalue) : returnvalue;
      if (!value || typeof value !== 'object') return;
      const row = value as Record<string, unknown>;
      if (
        Object.keys(row).length === 3 &&
        ['tenantId', 'conversationId', 'messageId'].every(
          (k) =>
            typeof row[k] === 'string' &&
            /^[0-9a-f-]{36}$/i.test(row[k] as string),
        )
      )
        publish({
          tenantId: String(row.tenantId),
          conversationId: String(row.conversationId),
          messageId: String(row.messageId),
        });
    } catch {
      /* Only minimal validated notices reach the application event bus. */
    }
  });
  return events;
}
