export type PlanCode = 'BASIC' | 'PRO' | 'ENTERPRISE';

export const PLAN_LIMIT_KEYS = [
  'maxUsers',
  'maxUnits',
  'maxProviders',
  'maxMonthlyAiRequests',
  'maxMonthlyAiTokens',
  'maxMonthlyMessages',
  'maxActiveIntegrations',
  'maxKnowledgeArticles',
  'maxMonthlyAppointments',
] as const;
export type PlanLimitKey = (typeof PLAN_LIMIT_KEYS)[number];

export const PLAN_CAPABILITIES = [
  'ai_enabled',
  'knowledge_base_enabled',
  'google_calendar_enabled',
  'advanced_analytics_enabled',
  'sla_enabled',
  'multi_unit_enabled',
  'custom_ai_configuration_enabled',
] as const;
export type PlanCapability = (typeof PLAN_CAPABILITIES)[number];
export type EnforcementMode = 'MEASURE_ONLY' | 'SOFT_LIMIT' | 'HARD_LIMIT';

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  limits: Record<PlanLimitKey, number | null>;
  enforcement: Record<PlanLimitKey, EnforcementMode>;
  capabilities: Record<PlanCapability, boolean>;
}

const commonCapabilities = {
  ai_enabled: true,
  knowledge_base_enabled: true,
  google_calendar_enabled: false,
  advanced_analytics_enabled: false,
  sla_enabled: true,
  multi_unit_enabled: false,
  custom_ai_configuration_enabled: false,
} satisfies Record<PlanCapability, boolean>;
const proCapabilities = {
  ...commonCapabilities,
  google_calendar_enabled: true,
  advanced_analytics_enabled: true,
  multi_unit_enabled: true,
  custom_ai_configuration_enabled: true,
} satisfies Record<PlanCapability, boolean>;
const enterpriseCapabilities = Object.fromEntries(
  PLAN_CAPABILITIES.map((capability) => [capability, true]),
) as Record<PlanCapability, boolean>;
const enforcement = {
  maxUsers: 'HARD_LIMIT',
  maxUnits: 'HARD_LIMIT',
  maxProviders: 'MEASURE_ONLY',
  maxMonthlyAiRequests: 'SOFT_LIMIT',
  maxMonthlyAiTokens: 'SOFT_LIMIT',
  maxMonthlyMessages: 'MEASURE_ONLY',
  maxActiveIntegrations: 'HARD_LIMIT',
  maxKnowledgeArticles: 'HARD_LIMIT',
  maxMonthlyAppointments: 'MEASURE_ONLY',
} satisfies Record<PlanLimitKey, EnforcementMode>;

export const PLAN_CATALOG: Record<PlanCode, PlanDefinition> = {
  BASIC: {
    code: 'BASIC',
    name: 'Basic',
    limits: {
      maxUsers: 5,
      maxUnits: 1,
      maxProviders: 5,
      maxMonthlyAiRequests: 2_000,
      maxMonthlyAiTokens: 1_000_000,
      maxMonthlyMessages: 10_000,
      maxActiveIntegrations: 1,
      maxKnowledgeArticles: 50,
      maxMonthlyAppointments: 300,
    },
    enforcement,
    capabilities: commonCapabilities,
  },
  PRO: {
    code: 'PRO',
    name: 'Pro',
    limits: {
      maxUsers: 25,
      maxUnits: 5,
      maxProviders: 50,
      maxMonthlyAiRequests: 20_000,
      maxMonthlyAiTokens: 10_000_000,
      maxMonthlyMessages: 100_000,
      maxActiveIntegrations: 5,
      maxKnowledgeArticles: 500,
      maxMonthlyAppointments: 5_000,
    },
    enforcement,
    capabilities: proCapabilities,
  },
  ENTERPRISE: {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    limits: Object.fromEntries(
      PLAN_LIMIT_KEYS.map((key) => [key, null]),
    ) as Record<PlanLimitKey, number | null>,
    enforcement,
    capabilities: enterpriseCapabilities,
  },
};

export const PLAN_ALERT_THRESHOLDS = [70, 85, 100] as const;
export const PLATFORM_CAPABILITIES: Record<PlanCapability, boolean> =
  enterpriseCapabilities;

export function isPlanCode(value: string): value is PlanCode {
  return Object.hasOwn(PLAN_CATALOG, value);
}

export function resolvePlanDefinition(planCode: string): PlanDefinition {
  if (!isPlanCode(planCode)) throw new Error('Unknown plan code.');
  return PLAN_CATALOG[planCode];
}

export function resolvePlanLimit(
  planCode: string,
  key: PlanLimitKey,
  overrides: unknown = {},
): number | null {
  const configured = resolvePlanDefinition(planCode).limits[key];
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))
    return configured;
  const limits = (overrides as Record<string, unknown>).limits;
  if (!limits || typeof limits !== 'object' || Array.isArray(limits))
    return configured;
  const value = (limits as Record<string, unknown>)[key];
  if (value === undefined) return configured;
  if (value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 1_000_000_000
  )
    return configured;
  return value;
}

export function resolvePlanCapabilities(
  planCode: string,
  overrides: unknown = {},
): Record<PlanCapability, boolean> {
  const included = resolvePlanDefinition(planCode).capabilities;
  const requested =
    overrides && typeof overrides === 'object' && !Array.isArray(overrides)
      ? (overrides as Record<string, unknown>).capabilities
      : undefined;
  return Object.fromEntries(
    PLAN_CAPABILITIES.map((key) => {
      const override =
        requested && typeof requested === 'object' && !Array.isArray(requested)
          ? (requested as Record<string, unknown>)[key]
          : undefined;
      const enabled = typeof override === 'boolean' ? override : included[key];
      return [key, PLATFORM_CAPABILITIES[key] && included[key] && enabled];
    }),
  ) as Record<PlanCapability, boolean>;
}

export function usageLevel(value: number, limit: number | null) {
  if (limit === null) return 'UNLIMITED' as const;
  const percent = limit === 0 ? (value > 0 ? 100 : 0) : (value / limit) * 100;
  if (value > limit) return 'OVER_LIMIT' as const;
  if (percent >= 85) return 'CRITICAL' as const;
  if (percent >= 70) return 'WARNING' as const;
  return 'NORMAL' as const;
}

export function comparePlanRank(from: string, to: string) {
  const rank: Record<PlanCode, number> = { BASIC: 1, PRO: 2, ENTERPRISE: 3 };
  if (!isPlanCode(from) || !isPlanCode(to))
    throw new Error('Unknown plan code.');
  return Math.sign(rank[to] - rank[from]);
}
