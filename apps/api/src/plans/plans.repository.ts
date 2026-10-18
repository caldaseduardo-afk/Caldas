import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, recordAutomationAudit } from '@atendente/database';
import { comparePlanRank, resolvePlanDefinition } from '@atendente/domain';
import type { TenantPlanContext } from '@atendente/types';
import { DatabaseService } from '../auth/database.service';
import { AuthorizationService, authorizedTenantFilter } from '../permissions/authorization.service';
import { createPlanContext, readPlanUsage } from './plan-usage';

@Injectable()
export class PlansRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}

  async current(): Promise<TenantPlanContext> {
    const scope = await this.authorization.requirePermissions('billing.view');
    return this.database.client.$transaction(
      async (tx) => {
        const tenant = await tx.tenant.findFirst({
          where: authorizedTenantFilter(scope, ['billing.view']),
          select: {
            id: true,
            calendarIntegration: { select: { status: true } },
            aiConfiguration: { select: { activeVersionId: true } },
            humanSlaRule: { select: { active: true } },
          },
        });
        if (!tenant) throw new NotFoundException('Recurso não encontrado.');
        let subscription = await tx.tenantSubscription.findUnique({
          where: { tenantId: scope.tenantId },
        });
        if (!subscription) throw new NotFoundException('Plano indisponível.');
        subscription = await this.advancePeriod(tx, subscription, scope.tenantId);
        const usage = await readPlanUsage(
          tx,
          scope.tenantId,
          subscription.currentPeriodStart,
          subscription.currentPeriodEnd,
        );
        const configuredCapabilities = {
          ai_enabled: true,
          knowledge_base_enabled: true,
          google_calendar_enabled: tenant.calendarIntegration?.status === 'ACTIVE',
          advanced_analytics_enabled: true,
          sla_enabled: tenant.humanSlaRule?.active ?? false,
          multi_unit_enabled: true,
          custom_ai_configuration_enabled: !!tenant.aiConfiguration?.activeVersionId,
        };
        return createPlanContext(subscription, usage, configuredCapabilities);
      },
      { isolationLevel: 'RepeatableRead', timeout: 10000 },
    );
  }

  async catalog() {
    await this.authorization.requirePermissions('billing.view');
    return Object.values({
      BASIC: resolvePlanDefinition('BASIC'),
      PRO: resolvePlanDefinition('PRO'),
      ENTERPRISE: resolvePlanDefinition('ENTERPRISE'),
    });
  }

  private async advancePeriod(
    tx: Prisma.TransactionClient,
    initial: Prisma.TenantSubscriptionGetPayload<object>,
    tenantId: string,
  ) {
    let subscription = initial;
    const now = new Date();
    if (
      subscription.status === 'GRACE' &&
      (!subscription.graceUntil || subscription.graceUntil <= now)
    ) {
      subscription = await tx.tenantSubscription.update({
        where: { tenantId },
        data: { status: 'SUSPENDED' },
      });
      await recordAutomationAudit(tx, {
        data: {
          type: 'GRACE_ENDED',
          tenantId,
          resourceId: subscription.id,
          changes: { before: { status: 'GRACE' }, after: { status: 'SUSPENDED' } },
        },
      });
    }
    let rounds = 0;
    while (subscription.currentPeriodEnd <= now && rounds < 120) {
      rounds++;
      const periodStart = subscription.currentPeriodEnd;
      const periodEnd = new Date(Date.UTC(
        periodStart.getUTCFullYear(),
        periodStart.getUTCMonth() + 1,
        1,
      ));
      const nextPlan = subscription.scheduledPlanCode;
      const beforePlan = subscription.planCode;
      const wasGraceExpired = subscription.status === 'GRACE' &&
        (!subscription.graceUntil || subscription.graceUntil <= now);
      subscription = await tx.tenantSubscription.update({
        where: { tenantId },
        data: {
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          ...(nextPlan ? { planCode: nextPlan, scheduledPlanCode: null } : {}),
          ...(wasGraceExpired ? { status: 'SUSPENDED' } : {}),
        },
      });
      if (nextPlan) {
        const event = comparePlanRank(beforePlan, nextPlan) < 0
          ? 'PLAN_UPGRADED'
          : comparePlanRank(beforePlan, nextPlan) > 0
            ? 'PLAN_DOWNGRADED'
            : 'PLAN_CHANGED';
        await recordAutomationAudit(tx, {
          data: {
            type: event,
            tenantId,
            resourceId: subscription.id,
            changes: { before: { planCode: beforePlan }, after: { planCode: nextPlan, effectiveAt: periodStart.toISOString() } },
          },
        });
      }
      if (wasGraceExpired)
        await recordAutomationAudit(tx, {
          data: {
            type: 'GRACE_ENDED',
            tenantId,
            resourceId: subscription.id,
            changes: { before: { status: 'GRACE' }, after: { status: 'SUSPENDED' } },
          },
        });
    }
    if (rounds === 120) throw new ConflictException('Período de plano inválido.');
    return subscription;
  }
}
