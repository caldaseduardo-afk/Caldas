import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
  Scope,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import type { AuthRequest } from '../auth/auth.guard';
import { RateLimitPolicy, RATE_LIMIT_POLICY } from './rate-limit.decorator';
import { RateLimitService, type RateLimitBucket } from './rate-limit.service';

@Injectable({ scope: Scope.REQUEST })
export class RateLimitInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthRequest>();
    const response = http.getResponse<Response>();
    const path = request.path;
    // Health must remain observable while Redis is unavailable.
    if (path === '/health' || path.startsWith('/health/')) return next.handle();

    const ip = request.ip || request.socket.remoteAddress || 'unknown';
    const route = `${request.method}:${request.baseUrl}${request.route?.path ?? path}`;
    const buckets: RateLimitBucket[] = [
      { scope: `ip:${ip}`, name: 'all', limit: 1200, windowSeconds: 60 },
    ];
    const tenantId = request.activeTenantId;
    if (tenantId)
      buckets.push({
        scope: `tenant:${tenantId}`,
        name: 'all',
        limit: 600,
        windowSeconds: 60,
      });
    else if (request.platform)
      buckets.push({
        scope: `platform:${request.platform.userId}`,
        name: 'all',
        limit: 600,
        windowSeconds: 60,
      });

    const policy = this.reflector.getAllAndOverride<RateLimitPolicy>(
      RATE_LIMIT_POLICY,
      [context.getHandler(), context.getClass()],
    );
    if (policy) {
      const scope = tenantId
        ? `tenant:${tenantId}`
        : request.platform
          ? `platform:${request.platform.userId}`
          : `ip:${ip}`;
      buckets.push({
        scope,
        name: route,
        limit: policy.limit,
        windowSeconds: policy.windowSeconds,
      });
    }

    const result = await this.limiter.consume(buckets);
    if (policy) response.setHeader('RateLimit-Limit', String(policy.limit));
    if (!result.allowed) {
      response.setHeader('Retry-After', String(result.retryAfterSeconds));
      throw new HttpException(
        'Limite de requisições excedido.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return next.handle();
  }
}
