import { Injectable } from '@nestjs/common';
export function holdTtlSeconds(value: string | undefined) {
  const ttl = Number(value ?? '300');
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 86400)
    throw new Error('HOLD_TTL_SECONDS deve estar entre 1 e 86400.');
  return ttl;
}
@Injectable()
export class HoldConfig {
  readonly ttlSeconds = holdTtlSeconds(process.env.HOLD_TTL_SECONDS);
}
