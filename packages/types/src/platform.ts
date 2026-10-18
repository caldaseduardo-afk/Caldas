export interface PlatformOverview {
  period: { from: string; to: string; timezone: string };
  tenant: {
    id: string;
    name: string;
    status: string;
    timezone: string;
    createdAt: string;
  } | null;
  summary: Record<string, number | null>;
  clinics: {
    id: string;
    name: string;
    status: string;
    timezone: string;
    createdAt: string;
    users: number;
    messages: number;
    conversations: number;
    appointments: number;
    tokens: number | null;
    lastActivity: string | null;
    plan: {
      code: string;
      name: string;
      status: string;
      currentPeriodStart: string;
      currentPeriodEnd: string;
      graceUntil: string | null;
      scheduledPlanCode: string | null;
      overLimit: boolean;
      alertCount: number;
      keyMetrics: PlanUsageMetric[];
    } | null;
  }[];
  totalClinics: number;
  page: number;
  limit: number;
  usage: {
    tenantId: string;
    provider: string;
    model: string;
    requests: number;
    errors: number;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    unknownTokens: number;
    latencyMs: number | null;
    attempts: number;
  }[];
  integrations: {
    id: string;
    tenantId: string;
    tenantName: string;
    type: string;
    status: string;
    updatedAt: string;
    lastTestedAt: string | null;
    errorCode: string | null;
  }[];
  incidents: {
    tenantId: string;
    type: string;
    severity: string;
    count: number;
  }[];
  groups: { kind: string; status: string; count: number }[];
  series: { date: string; kind: string; count: number }[];
  webhookErrors: null;
}
export interface PlatformHealth {
  state: string;
  failedJobs: number;
  externalProviders: string;
  redis: string;
  worker: string;
  heartbeatAt: string | null;
  queues: {
    name: string;
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
  }[];
}
import type { PlanUsageMetric } from './plans';
