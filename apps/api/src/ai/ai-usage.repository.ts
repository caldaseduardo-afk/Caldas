import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AIUsageTokens } from '@atendente/domain';
import { DatabaseService } from '../auth/database.service';
import { authorizedTenantFilter } from '../permissions/authorization.service';
import type { TenantScope } from '../tenancy/tenant.context';
export interface AIUsageResult {
  status: 'SUCCESS' | 'ERROR';
  usage: AIUsageTokens | null;
  latencyMs: number;
  attempts: number;
  errorCode?: string;
  providerRequestId?: string;
}
@Injectable()
export class AIUsageRepository {
  constructor(private readonly database: DatabaseService) {}
  async begin(
    scope: TenantScope,
    model: string,
    correlationId: string,
    aiConfigurationVersionId?: string | null,
  ) {
    const tenantId = scope.tenantId;
    const row = await this.database.client.$transaction(async (tx) => {
      const tenant = await tx.tenant.findFirst({
        where: authorizedTenantFilter(scope, ['settings.manage']),
        select: { id: true },
      });
      if (!tenant) throw new ForbiddenException('Permissão insuficiente.');
      return tx.aIUsage.create({
        data: {
          tenantId,
          model,
          provider: 'openai',
          correlationId,
          aiConfigurationVersionId: aiConfigurationVersionId ?? null,
        },
        select: { id: true },
      });
    });
    // A private capability bound to the admitted invocation. No caller-supplied tenant/id at completion.
    // Session revocation must not erase consumption that has already happened.
    return async (result: AIUsageResult) => {
      const updated = await this.database.client.aIUsage.updateMany({
        where: { id: row.id, tenantId, status: 'PENDING' },
        data: {
          status: result.status,
          inputTokens: result.usage?.inputTokens ?? null,
          outputTokens: result.usage?.outputTokens ?? null,
          totalTokens: result.usage?.totalTokens ?? null,
          latencyMs: result.latencyMs,
          attempts: result.attempts,
          errorCode: result.errorCode ?? null,
          providerRequestId: result.providerRequestId ?? null,
          completedAt: new Date(),
        },
      });
      if (updated.count !== 1) throw new Error('AI_USAGE_FINALIZATION_FAILED');
    };
  }
  async list(scope: TenantScope) {
    const allowed = await this.database.client.tenant.findFirst({
      where: authorizedTenantFilter(scope, ['analytics.view']),
      select: { id: true },
    });
    if (!allowed) throw new ForbiddenException('Permissão insuficiente.');
    return this.database.client.aIUsage.findMany({
      where: {
        tenantId: scope.tenantId,
        tenant: authorizedTenantFilter(scope, ['analytics.view']),
      },
      select: {
        id: true,
        provider: true,
        model: true,
        status: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        estimatedCost: true,
        latencyMs: true,
        attempts: true,
        errorCode: true,
        correlationId: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  }
}
