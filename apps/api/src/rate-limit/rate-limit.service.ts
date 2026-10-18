import { createHmac } from 'node:crypto';
import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import Redis from 'ioredis';
import { AuthConfig } from '../auth/auth.config';

const incrementScript = `
local denied = false
local retry = 1
for i, key in ipairs(KEYS) do
  local current = tonumber(redis.call('GET', key) or '0')
  local maximum = tonumber(ARGV[(i - 1) * 2 + 1])
  if current >= maximum then
    denied = true
    local ttl = redis.call('PTTL', key)
    if ttl > retry * 1000 then retry = math.ceil(ttl / 1000) end
  end
end
if denied then return {0, retry} end
for i, key in ipairs(KEYS) do
  local count = redis.call('INCR', key)
  if count == 1 then
    redis.call('PEXPIRE', key, ARGV[(i - 1) * 2 + 2])
  end
end
return {1, 0}
`;

export interface RateLimitBucket {
  readonly scope: string;
  readonly name: string;
  readonly limit: number;
  readonly windowSeconds: number;
}

@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly redis?: Redis;
  private readonly memory = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly auth: AuthConfig) {
    const url = process.env.REDIS_URL;
    if (url) {
      this.redis = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: true,
      });
      // ioredis emits connection errors even when the command promise is handled.
      // Keep diagnostics generic here; requests receive a safe 503 on failure.
      this.redis.on('error', () => undefined);
    } else if (process.env.NODE_ENV === 'production') {
      throw new Error('REDIS_URL é obrigatória para rate limiting em produção.');
    }
  }

  async consume(buckets: readonly RateLimitBucket[]) {
    const keys = buckets.map(({ scope, name, windowSeconds }) => {
      const fingerprint = createHmac('sha256', this.auth.secret)
        .update(`${scope}\0${name}`)
        .digest('hex');
      return `api-rate:v1:${fingerprint}:${windowSeconds}`;
    });

    if (this.redis) {
      try {
        const result = (await this.redis.eval(
          incrementScript,
          keys.length,
          ...keys,
          ...buckets.flatMap(({ limit, windowSeconds }) => [limit, windowSeconds * 1000]),
        )) as [number, number];
        return { allowed: result[0] === 1, retryAfterSeconds: result[1] };
      } catch {
        // Fail closed for protected API operations instead of silently dropping
        // distributed limits when Redis is unavailable.
        throw new ServiceUnavailableException('Controle de tráfego indisponível.');
      }
    }

    const now = Date.now();
    if (this.memory.size > 10_000) {
      for (const [key, value] of this.memory)
        if (value.expiresAt <= now) this.memory.delete(key);
      while (this.memory.size > 10_000)
        this.memory.delete(this.memory.keys().next().value!);
    }
    const entries = keys.map((key, index) => {
      const bucket = buckets[index]!;
      let value = this.memory.get(key);
      if (!value || value.expiresAt <= now) {
        value = { count: 0, expiresAt: now + bucket.windowSeconds * 1000 };
        this.memory.set(key, value);
      }
      return { value, bucket };
    });
    const denied = entries.find(({ value, bucket }) => value.count >= bucket.limit);
    if (denied)
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((denied.value.expiresAt - now) / 1000)),
      };
    for (const { value } of entries) value.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  async isAvailable() {
    if (!this.redis) return process.env.NODE_ENV !== 'production';
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    if (this.redis) await this.redis.quit().catch(() => this.redis?.disconnect());
  }
}
