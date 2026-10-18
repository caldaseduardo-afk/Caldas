import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { humanSlaConnection } from './human-sla-queue';
export const PLATFORM_QUEUES = [
  'human-sla',
  'calendar-sync',
  'appointment-notifications',
  'conversation-engine',
  'whatsapp-delivery',
] as const;
const heartbeatKey = 'platform:worker:heartbeat';
function connection(url: string) {
  return {
    ...humanSlaConnection(url),
    connectTimeout: 2000,
    commandTimeout: 2000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  };
}
export async function platformHealth(url: string) {
  const redis = new Redis(connection(url));
  redis.on('error', () => undefined);
  const queues: Queue[] = [];
  try {
    await redis.ping();
    const heartbeat = await redis.get(heartbeatKey);
    const counts = await Promise.all(
      PLATFORM_QUEUES.map(async (name) => {
        const queue = new Queue(name, { connection: connection(url) });
        queues.push(queue);
        queue.on('error', () => undefined);
        const counts = await queue.getJobCounts(
          'waiting',
          'active',
          'delayed',
          'failed',
        );
        return {
          name,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          failed: counts.failed ?? 0,
        };
      }),
    );
    return {
      redis: 'UP' as const,
      worker: heartbeat ? ('UP' as const) : ('UNKNOWN' as const),
      heartbeatAt: heartbeat,
      queues: counts,
    };
  } catch {
    return {
      redis: 'UNKNOWN' as const,
      worker: 'UNKNOWN' as const,
      heartbeatAt: null,
      queues: [],
    };
  } finally {
    redis.disconnect();
    await Promise.all(queues.map((q) => q.close().catch(() => undefined)));
  }
}
/** TTL proves only that at least one worker process recently ran its event loop. */
export function startPlatformHeartbeat(
  url: string,
  options: { ttlSeconds?: number; intervalMs?: number } = {},
) {
  const ttlSeconds = options.ttlSeconds ?? 60;
  const intervalMs = options.intervalMs ?? 15000;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 60 || !Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 15000) throw new Error('Worker heartbeat interval is invalid.');
  const redis = new Redis({
    ...connection(url),
    enableOfflineQueue: false,
    retryStrategy: (attempt: number) => Math.min(attempt * 500, 15000),
  });
  redis.on('error', () => undefined);
  let stopped = false;
  const beat = async () => {
    if (!stopped)
      await redis
        .set(heartbeatKey, new Date().toISOString(), 'EX', ttlSeconds)
        .catch(() => undefined);
  };
  void beat();
  const timer = setInterval(() => {
    void beat();
  }, intervalMs);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
    redis.disconnect();
  };
}
