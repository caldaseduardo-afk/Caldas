import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PLAN_CATALOG,
  comparePlanRank,
  resolvePlanCapabilities,
  resolvePlanLimit,
  usageLevel,
} from '@atendente/domain';
import { createPlanContext, validatePlanOverrides } from '../src/plans/plan-usage';
import { parseSubscriptionChange } from '../src/plans/plans.dto';

test('catálogo define limites, enforcement e capabilities dos três planos', () => {
  assert.equal(PLAN_CATALOG.BASIC.limits.maxUnits, 1);
  assert.equal(PLAN_CATALOG.BASIC.enforcement.maxMonthlyAiTokens, 'SOFT_LIMIT');
  assert.equal(PLAN_CATALOG.BASIC.enforcement.maxUnits, 'HARD_LIMIT');
  assert.equal(PLAN_CATALOG.ENTERPRISE.limits.maxUsers, null);
  assert.equal(PLAN_CATALOG.BASIC.capabilities.google_calendar_enabled, false);
  assert.equal(PLAN_CATALOG.PRO.capabilities.google_calendar_enabled, true);
  assert.equal(comparePlanRank('BASIC', 'PRO'), 1);
});

test('overrides são tipados, limitados e não ativam capability ausente do plano', () => {
  assert.equal(resolvePlanLimit('BASIC', 'maxUnits', { limits: { maxUnits: 3 } }), 3);
  assert.equal(resolvePlanCapabilities('BASIC', { capabilities: { google_calendar_enabled: true } }).google_calendar_enabled, false);
  assert.throws(() => validatePlanOverrides({ unexpected: true }));
  assert.throws(() => validatePlanOverrides({ limits: { maxUnits: -1 } }));
  assert.throws(() => validatePlanOverrides({ capabilities: { google_calendar_enabled: 'yes' } }));
});

test('consumo agrega mensagens para limite sem perder inbound/outbound e gera níveis/alertas', () => {
  const context = createPlanContext({
    planCode: 'BASIC', status: 'ACTIVE', currentPeriodStart: new Date('2026-10-01T00:00:00Z'),
    currentPeriodEnd: new Date('2026-11-01T00:00:00Z'), graceUntil: null, scheduledPlanCode: null, overrides: {},
  }, {
    AI_REQUESTS: 0, AI_TOKENS: 0, MESSAGES_INBOUND: 7000, MESSAGES_OUTBOUND: 3000,
    APPOINTMENTS_CREATED: 0, ACTIVE_USERS: 1, ACTIVE_UNITS: 1, ACTIVE_PROVIDERS: 0,
    ACTIVE_INTEGRATIONS: 0, KNOWLEDGE_ARTICLES: 0, unknownAiTokenRequests: 0,
  });
  assert.equal(context.messageBreakdown.inbound, 7000);
  assert.equal(context.messageBreakdown.outbound, 3000);
  assert.equal(context.usage.find((m) => m.metric === 'MESSAGES_TOTAL')?.percent, 100);
  assert.equal(context.alerts.filter((a) => a.metric.startsWith('MESSAGES')).length, 1);
  assert.equal(usageLevel(11, 10), 'OVER_LIMIT');
  assert.equal(usageLevel(10, 10), 'CRITICAL');
});

test('DTO de assinatura rejeita entrada vazia ou campo inesperado e aceita agendamento', () => {
  assert.throws(() => parseSubscriptionChange({}));
  assert.throws(() => parseSubscriptionChange({ planCode: 'PRO', tenantId: 'forged' }));
  assert.equal(parseSubscriptionChange({ planCode: 'PRO', applyAt: 'NEXT_CYCLE' }).applyAt, 'NEXT_CYCLE');
});
