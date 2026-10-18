import { Injectable, Logger } from '@nestjs/common';
import { platformHealth } from '@atendente/database';
import { PlatformRepository } from './platform.repository';
import type { SubscriptionChange } from '../plans/plans.dto';
import type { PlatformScope } from './platform-auth.service';
import type { PlatformQuery } from './platform.dto';
@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);
  constructor(private readonly repository: PlatformRepository) {}
  async read(
    scope: PlatformScope,
    query: PlatformQuery,
    targetTenantId?: string,
  ) {
    const start = Date.now();
    try {
      const result = await this.repository.read(scope, query, targetTenantId);
      this.logger.log({
        action: 'super_admin_read',
        actorUserId: scope.userId,
        targetTenantId,
        durationMs: Date.now() - start,
      });
      return result;
    } catch (error) {
      this.logger.warn({
        action: 'super_admin_read',
        actorUserId: scope.userId,
        targetTenantId,
        durationMs: Date.now() - start,
        code: 'PLATFORM_READ_FAILED',
      });
      throw error;
    }
  }
  async health() {
    const health = await platformHealth(process.env.REDIS_URL ?? '').catch(
      () => ({
        redis: 'UNKNOWN',
        worker: 'UNKNOWN',
        heartbeatAt: null,
        queues: [],
      }),
    );
    const failedJobs = health.queues.reduce(
      (sum, queue) => sum + queue.failed,
      0,
    );
    return {
      ...health,
      failedJobs,
      state:
        health.redis !== 'UP' || health.worker !== 'UP'
          ? 'CRITICAL'
          : failedJobs > 0
            ? 'DEGRADED'
            : 'HEALTHY',
      externalProviders: 'UNKNOWN',
    };
  }

  async changeSubscription(
    scope: PlatformScope,
    tenantId: string,
    change: SubscriptionChange,
  ) {
    const startedAt = Date.now();
    try {
      const result = await this.repository.changeSubscription(scope, tenantId, change);
      this.logger.log({
        action: 'platform_subscription_changed',
        actorUserId: scope.userId,
        targetTenantId: tenantId,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      this.logger.warn({
        action: 'platform_subscription_change_failed',
        actorUserId: scope.userId,
        targetTenantId: tenantId,
        durationMs: Date.now() - startedAt,
        code: 'PLATFORM_SUBSCRIPTION_CHANGE_FAILED',
      });
      throw error;
    }
  }
}
