import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_POLICY = 'rate-limit:policy';
export interface RateLimitPolicy {
  readonly limit: number;
  readonly windowSeconds: number;
}

export function RateLimit(limit: number, windowSeconds = 60) {
  return SetMetadata(RATE_LIMIT_POLICY, { limit, windowSeconds } satisfies RateLimitPolicy);
}
