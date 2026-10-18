export type PlanMetricCode =
  | 'AI_REQUESTS'
  | 'AI_TOKENS'
  | 'MESSAGES_TOTAL'
  | 'MESSAGES_INBOUND'
  | 'MESSAGES_OUTBOUND'
  | 'APPOINTMENTS_CREATED'
  | 'ACTIVE_USERS'
  | 'ACTIVE_UNITS'
  | 'ACTIVE_PROVIDERS'
  | 'ACTIVE_INTEGRATIONS'
  | 'KNOWLEDGE_ARTICLES';

export interface PlanUsageMetric {
  metric: PlanMetricCode;
  label: string;
  value: number;
  limit: number | null;
  percent: number | null;
  enforcement: 'MEASURE_ONLY' | 'SOFT_LIMIT' | 'HARD_LIMIT';
  level: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'OVER_LIMIT' | 'UNLIMITED';
}

export interface TenantPlanContext {
  plan: { code: string; name: string };
  subscription: {
    status: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    graceUntil: string | null;
    scheduledPlanCode: string | null;
    overLimit: boolean;
  };
  usage: PlanUsageMetric[];
  messageBreakdown: { inbound: number; outbound: number };
  alerts: { metric: PlanMetricCode; level: string; percent: number }[];
  capabilities: Record<string, boolean>;
  configuredCapabilities: Record<string, boolean>;
  unknownAiTokenRequests: number;
}
