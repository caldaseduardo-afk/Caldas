import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthConfig } from '../src/auth/auth.config';
import { RateLimitService } from '../src/rate-limit/rate-limit.service';

test('rate limit uses isolated scopes and enforces a bounded window', async () => {
  const config = new AuthConfig({
    AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    AUTH_ORIGIN: 'http://localhost:3000',
    NODE_ENV: 'test',
  } as NodeJS.ProcessEnv);
  const limiter = new RateLimitService(config);
  const bucket = (scope: string) => [
    { scope, name: 'expensive-route', limit: 2, windowSeconds: 60 },
  ];

  assert.equal((await limiter.consume(bucket('tenant:a'))).allowed, true);
  assert.equal((await limiter.consume(bucket('tenant:a'))).allowed, true);
  const denied = await limiter.consume(bucket('tenant:a'));
  assert.equal(denied.allowed, false);
  assert.ok(denied.retryAfterSeconds >= 1);
  assert.equal((await limiter.consume(bucket('tenant:b'))).allowed, true);
  await limiter.onModuleDestroy();
});
