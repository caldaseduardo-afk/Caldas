import {
  PLAN_CATALOG,
  PLAN_LIMIT_KEYS,
  PLAN_ALERT_THRESHOLDS,
  resolvePlanCapabilities,
  resolvePlanDefinition,
  resolvePlanLimit,
  usageLevel,
  type PlanCapability,
  type PlanLimitKey,
} from '@atendente/domain';
import type { PlanMetricCode, PlanUsageMetric, TenantPlanContext } from '@atendente/types';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@atendente/database';

export type PlanUsageValues = Record<Exclude<PlanMetricCode, 'MESSAGES_TOTAL'>, number> & {
  unknownAiTokenRequests: number;
};

const metrics: Array<{
  metric: PlanMetricCode;
  label: string;
  limitKey: PlanLimitKey;
  mode: 'MEASURE_ONLY' | 'SOFT_LIMIT' | 'HARD_LIMIT';
}> = [
  { metric: 'AI_REQUESTS', label: 'Solicitações de IA', limitKey: 'maxMonthlyAiRequests', mode: 'SOFT_LIMIT' },
  { metric: 'AI_TOKENS', label: 'Tokens de IA', limitKey: 'maxMonthlyAiTokens', mode: 'SOFT_LIMIT' },
  { metric: 'MESSAGES_TOTAL', label: 'Mensagens (recebidas + enviadas)', limitKey: 'maxMonthlyMessages', mode: 'MEASURE_ONLY' },
  { metric: 'APPOINTMENTS_CREATED', label: 'Consultas criadas', limitKey: 'maxMonthlyAppointments', mode: 'MEASURE_ONLY' },
  { metric: 'ACTIVE_USERS', label: 'Usuários ativos', limitKey: 'maxUsers', mode: 'HARD_LIMIT' },
  { metric: 'ACTIVE_UNITS', label: 'Unidades ativas', limitKey: 'maxUnits', mode: 'HARD_LIMIT' },
  { metric: 'ACTIVE_PROVIDERS', label: 'Profissionais ativos', limitKey: 'maxProviders', mode: 'MEASURE_ONLY' },
  { metric: 'ACTIVE_INTEGRATIONS', label: 'Integrações ativas', limitKey: 'maxActiveIntegrations', mode: 'HARD_LIMIT' },
  { metric: 'KNOWLEDGE_ARTICLES', label: 'Artigos da base de conhecimento', limitKey: 'maxKnowledgeArticles', mode: 'HARD_LIMIT' },
];

export async function readPlanUsage(
  tx: Prisma.TransactionClient,
  tenantId: string,
  from: Date,
  until: Date,
): Promise<PlanUsageValues> {
  const [row] = await tx.$queryRaw<Array<Record<string, number>>>(Prisma.sql`
    SELECT
      (SELECT count(*)::int FROM ai_usage WHERE tenant_id=${tenantId}::uuid AND created_at>=${from} AND created_at<${until}) AS ai_requests,
      COALESCE((SELECT sum(total_tokens)::float8 FROM ai_usage WHERE tenant_id=${tenantId}::uuid AND created_at>=${from} AND created_at<${until}),0) AS ai_tokens,
      (SELECT count(*)::int FROM ai_usage WHERE tenant_id=${tenantId}::uuid AND total_tokens IS NULL AND created_at>=${from} AND created_at<${until}) AS unknown_ai_tokens,
      (SELECT count(*)::int FROM messages WHERE tenant_id=${tenantId}::uuid AND sender_type::text='PATIENT' AND created_at>=${from} AND created_at<${until}) AS messages_inbound,
      (SELECT count(*)::int FROM messages WHERE tenant_id=${tenantId}::uuid AND sender_type::text<>'PATIENT' AND created_at>=${from} AND created_at<${until}) AS messages_outbound,
      (SELECT count(*)::int FROM appointments WHERE tenant_id=${tenantId}::uuid AND created_at>=${from} AND created_at<${until}) AS appointments_created,
      (SELECT count(*)::int FROM user_tenants ut JOIN users u ON u.id=ut.user_id WHERE ut.tenant_id=${tenantId}::uuid AND ut.active AND u.status='ACTIVE') AS active_users,
      (SELECT count(*)::int FROM units WHERE tenant_id=${tenantId}::uuid AND active) AS active_units,
      (SELECT count(*)::int FROM providers WHERE tenant_id=${tenantId}::uuid AND active) AS active_providers,
      ((SELECT count(*) FROM integrations WHERE tenant_id=${tenantId}::uuid AND status='ACTIVE') + (SELECT count(*) FROM calendar_integrations WHERE tenant_id=${tenantId}::uuid AND status='ACTIVE'))::int AS active_integrations,
      (SELECT count(*)::int FROM knowledge_articles WHERE tenant_id=${tenantId}::uuid AND status<>'INACTIVE') AS knowledge_articles
  `);
  if (!row) throw new Error('Usage aggregate unavailable.');
  return {
    AI_REQUESTS: row.ai_requests,
    AI_TOKENS: row.ai_tokens,
    MESSAGES_INBOUND: row.messages_inbound,
    MESSAGES_OUTBOUND: row.messages_outbound,
    APPOINTMENTS_CREATED: row.appointments_created,
    ACTIVE_USERS: row.active_users,
    ACTIVE_UNITS: row.active_units,
    ACTIVE_PROVIDERS: row.active_providers,
    ACTIVE_INTEGRATIONS: row.active_integrations,
    KNOWLEDGE_ARTICLES: row.knowledge_articles,
    unknownAiTokenRequests: row.unknown_ai_tokens,
  };
}

export function createPlanContext(
  subscription: {
    planCode: string;
    status: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    graceUntil: Date | null;
    scheduledPlanCode: string | null;
    overrides: unknown;
  },
  values: PlanUsageValues,
  configuredCapabilities: Record<PlanCapability, boolean> = Object.fromEntries(
    Object.keys(PLAN_CATALOG.BASIC.capabilities).map((key) => [key, true]),
  ) as Record<PlanCapability, boolean>,
): TenantPlanContext {
  const definition = resolvePlanDefinition(subscription.planCode);
  const usage: PlanUsageMetric[] = metrics.map((item) => {
    const value = item.metric === 'MESSAGES_TOTAL'
      ? values.MESSAGES_INBOUND + values.MESSAGES_OUTBOUND
      : values[item.metric];
    const limit = resolvePlanLimit(
      subscription.planCode,
      item.limitKey,
      subscription.overrides,
    );
    const level = usageLevel(value, limit);
    return {
      metric: item.metric,
      label: item.label,
      value,
      limit,
      percent: limit === null ? null : limit === 0 ? (value > 0 ? 100 : 0) : (value / limit) * 100,
      enforcement: item.mode,
      level,
    };
  });
  const alerts = usage.flatMap((metric) =>
    metric.percent === null || metric.percent < PLAN_ALERT_THRESHOLDS[0]
      ? []
      : [{ metric: metric.metric, level: metric.level, percent: Math.round(metric.percent) }],
  );
  const overLimit = usage.some((metric) => metric.level === 'OVER_LIMIT');
  return {
    plan: { code: definition.code, name: definition.name },
    subscription: {
      status: subscription.status,
      currentPeriodStart: subscription.currentPeriodStart.toISOString(),
      currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
      graceUntil: subscription.graceUntil?.toISOString() ?? null,
      scheduledPlanCode: subscription.scheduledPlanCode,
      overLimit,
    },
    usage,
    messageBreakdown: {
      inbound: values.MESSAGES_INBOUND,
      outbound: values.MESSAGES_OUTBOUND,
    },
    alerts,
    capabilities: resolvePlanCapabilities(subscription.planCode, subscription.overrides),
    configuredCapabilities,
    unknownAiTokenRequests: values.unknownAiTokenRequests,
  };
}

export async function assertHardPlanLimit(
  tx: Prisma.TransactionClient,
  tenantId: string,
  key: PlanLimitKey,
) {
  await tx.$queryRaw(Prisma.sql`SELECT tenant_id FROM tenant_subscriptions WHERE tenant_id=${tenantId}::uuid FOR UPDATE`);
  const subscription = await tx.tenantSubscription.findUnique({ where: { tenantId } });
  if (!subscription) throw new Error('Tenant subscription is missing.');
  const limit = resolvePlanLimit(subscription.planCode, key, subscription.overrides);
  if (limit === null) return;
  const current = await readInstantUsage(tx, tenantId, key);
  const now = new Date();
  const expiredGrace = subscription.status === 'GRACE' && (!subscription.graceUntil || subscription.graceUntil <= now);
  const unavailable = ['SUSPENDED', 'CANCELLED'].includes(subscription.status) || expiredGrace;
  if (unavailable || current >= limit)
    throw new ConflictException({
      code: 'PLAN_LIMIT_REACHED',
      message: 'O limite do plano impede a criação deste recurso. Reduza o uso ou solicite uma alteração de plano.',
    });
}

export async function assertPlanCapability(
  tx: Prisma.TransactionClient,
  tenantId: string,
  capability: PlanCapability,
) {
  const subscription = await tx.tenantSubscription.findUnique({ where: { tenantId } });
  if (!subscription) throw new Error('Tenant subscription is missing.');
  const available = resolvePlanCapabilities(subscription.planCode, subscription.overrides)[capability];
  const now = new Date();
  const graceExpired = subscription.status === 'GRACE' && (!subscription.graceUntil || subscription.graceUntil <= now);
  if (!available || ['SUSPENDED', 'CANCELLED'].includes(subscription.status) || graceExpired)
    throw new ForbiddenException({
      code: 'PLAN_FEATURE_NOT_AVAILABLE',
      message: 'Este recurso não está disponível no plano atual.',
    });
}

async function readInstantUsage(
  tx: Prisma.TransactionClient,
  tenantId: string,
  key: PlanLimitKey,
) {
  switch (key) {
    case 'maxUsers':
      return tx.userTenant.count({ where: { tenantId, active: true, user: { status: 'ACTIVE' } } });
    case 'maxUnits':
      return tx.unit.count({ where: { tenantId, active: true } });
    case 'maxProviders':
      return tx.provider.count({ where: { tenantId, active: true } });
    case 'maxActiveIntegrations': {
      const [whatsapp, calendar] = await Promise.all([
        tx.integration.count({ where: { tenantId, status: 'ACTIVE' } }),
        tx.calendarIntegration.count({ where: { tenantId, status: 'ACTIVE' } }),
      ]);
      return whatsapp + calendar;
    }
    case 'maxKnowledgeArticles':
      return tx.knowledgeArticle.count({ where: { tenantId, status: { not: 'INACTIVE' } } });
    default:
      return 0;
  }
}

export function validatePlanOverrides(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Overrides must be an object.');
  const input = raw as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['limits', 'capabilities'].includes(key)))
    throw new Error('Unknown override field.');
  const limits = input.limits;
  const capabilities = input.capabilities;
  if (limits !== undefined && (!limits || typeof limits !== 'object' || Array.isArray(limits)))
    throw new Error('Invalid limit overrides.');
  if (capabilities !== undefined && (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)))
    throw new Error('Invalid capability overrides.');
  const normalizedLimits: Record<string, number | null> = {};
  for (const [key, value] of Object.entries((limits ?? {}) as Record<string, unknown>)) {
    if (!(PLAN_LIMIT_KEYS as readonly string[]).includes(key)) throw new Error('Unknown plan limit.');
    if (value !== null && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000)) throw new Error('Invalid plan limit.');
    normalizedLimits[key] = value as number | null;
  }
  const normalizedCapabilities: Record<string, boolean> = {};
  for (const [key, value] of Object.entries((capabilities ?? {}) as Record<string, unknown>)) {
    if (!Object.hasOwn(PLAN_CATALOG.ENTERPRISE.capabilities, key) || typeof value !== 'boolean') throw new Error('Invalid capability override.');
    normalizedCapabilities[key] = value;
  }
  return {
    ...(limits !== undefined ? { limits: normalizedLimits } : {}),
    ...(capabilities !== undefined ? { capabilities: normalizedCapabilities } : {}),
  };
}
