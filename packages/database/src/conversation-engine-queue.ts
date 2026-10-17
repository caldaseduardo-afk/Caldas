import { Queue, Worker, QueueEvents } from 'bullmq';
import type { PrismaClient } from './generated/prisma/client';
import { humanSlaConnection } from './human-sla-queue';
import { databaseNow } from './hold-expiration';

export const CONVERSATION_ENGINE_QUEUE = 'conversation-engine';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ConversationEngineJob {
  tenantId: string;
  conversationId: string;
  messageId: string;
  runId: string;
}

export interface ConversationEngineNotice {
  tenantId: string;
  conversationId: string;
  messageId?: string;
  type:
    'message.created' | 'conversation.updated' | 'conversation.status_changed';
}

export function parseConversationEngineJob(
  value: unknown,
): ConversationEngineJob {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Job do conversation engine inválido.');
  const row = value as Record<string, unknown>;
  const keys = ['tenantId', 'conversationId', 'messageId', 'runId'];
  if (
    Object.keys(row).length !== keys.length ||
    keys.some(
      (key) => typeof row[key] !== 'string' || !uuid.test(String(row[key])),
    )
  )
    throw new Error('Job do conversation engine inválido.');
  return row as unknown as ConversationEngineJob;
}

export function createConversationEngineQueue(redis: string) {
  const queue = new Queue<ConversationEngineJob, ConversationEngineNotice[]>(
    CONVERSATION_ENGINE_QUEUE,
    {
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
    },
  );
  queue.on('error', () =>
    console.error('Fila do conversation engine indisponível.'),
  );
  return queue;
}

export async function enqueueConversationEngineRun(
  queue: ReturnType<typeof createConversationEngineQueue>,
  job: ConversationEngineJob,
  attempt = 0,
) {
  const value = parseConversationEngineJob(job);
  const jobId = `${value.runId}-${attempt}`;
  const existing = await queue.getJob(jobId);
  if (!existing) await queue.add('process-inbound', value, { jobId });
}

export async function dispatchConversationEngineRuns(
  client: PrismaClient,
  queue: ReturnType<typeof createConversationEngineQueue>,
) {
  const now = await databaseNow(client);
  const stale = new Date(+now - 45000);
  const rows = await client.aIProcessingRun.findMany({
    where: {
      nextDispatchAt: { lte: now },
      OR: [
        { status: 'PENDING' },
        { status: 'PROCESSING', updatedAt: { lte: stale } },
      ],
      tenant: { status: 'ACTIVE' },
    },
    select: {
      id: true,
      tenantId: true,
      conversationId: true,
      inboundMessageId: true,
      attempts: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 100,
  });
  for (const row of rows)
    await enqueueConversationEngineRun(
      queue,
      {
        tenantId: row.tenantId,
        conversationId: row.conversationId,
        messageId: row.inboundMessageId,
        runId: row.id,
      },
      row.attempts,
    );
  return rows.length;
}

export function createConversationEngineWorker(
  redis: string,
  process: (job: ConversationEngineJob) => Promise<ConversationEngineNotice[]>,
) {
  const worker = new Worker<ConversationEngineJob, ConversationEngineNotice[]>(
    CONVERSATION_ENGINE_QUEUE,
    async (job) => {
      if (job.name !== 'process-inbound')
        throw new Error('Tipo de job inválido.');
      return process(parseConversationEngineJob(job.data));
    },
    { connection: humanSlaConnection(redis), concurrency: 8 },
  );
  worker.on('error', () =>
    console.error('Worker do conversation engine indisponível.'),
  );
  worker.on('failed', () =>
    console.error('Job do conversation engine falhou.'),
  );
  return worker;
}

function notice(value: unknown): ConversationEngineNotice | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.tenantId !== 'string' ||
    !uuid.test(row.tenantId) ||
    typeof row.conversationId !== 'string' ||
    !uuid.test(row.conversationId) ||
    ![
      'message.created',
      'conversation.updated',
      'conversation.status_changed',
    ].includes(String(row.type)) ||
    (row.messageId !== undefined &&
      (typeof row.messageId !== 'string' || !uuid.test(row.messageId)))
  )
    return null;
  return {
    tenantId: row.tenantId,
    conversationId: row.conversationId,
    type: row.type as ConversationEngineNotice['type'],
    ...(row.messageId ? { messageId: String(row.messageId) } : {}),
  };
}

export function subscribeConversationEngineUpdates(
  redis: string,
  publish: (event: ConversationEngineNotice) => void,
) {
  const events = new QueueEvents(CONVERSATION_ENGINE_QUEUE, {
    connection: humanSlaConnection(redis),
  });
  events.on('error', () =>
    console.error('Eventos do conversation engine indisponíveis.'),
  );
  events.on('completed', ({ returnvalue }) => {
    try {
      const values: unknown =
        typeof returnvalue === 'string' ? JSON.parse(returnvalue) : returnvalue;
      if (!Array.isArray(values) || values.length > 3) return;
      for (const value of values) {
        const parsed = notice(value);
        if (parsed) publish(parsed);
      }
    } catch {
      /* Untrusted queue output never reaches the application event bus. */
    }
  });
  return events;
}
