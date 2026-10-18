import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, recordAudit } from '@atendente/database';
import { comparePlanRank } from '@atendente/domain';
import { DatabaseService } from '../auth/database.service';
import { requirePlatform, type PlatformScope } from './platform-auth.service';
import type { PlatformQuery } from './platform.dto';
import { civilPeriod, addDays } from '../analytics/analytics.metrics';
import type { SubscriptionChange } from '../plans/plans.dto';
import { createPlanContext, type PlanUsageValues } from '../plans/plan-usage';

@Injectable()
export class PlatformRepository {
  constructor(private readonly database: DatabaseService) {}
  async read(
    scope: PlatformScope,
    query: PlatformQuery,
    targetTenantId?: string,
  ) {
    return this.database.client.$transaction(
      async (tx) => {
        await requirePlatform(tx, scope);
        const tenant = targetTenantId
          ? await tx.tenant.findUnique({
              where: { id: targetTenantId },
              select: {
                id: true,
                name: true,
                status: true,
                timezone: true,
                createdAt: true,
              },
            })
          : null;
        if (targetTenantId && !tenant) throw new NotFoundException();
        const timezone = tenant?.timezone ?? 'UTC';
        const period = civilPeriod(query, new Date(), timezone);
        const bounds = await tx.$queryRaw<
          Array<{ start: Date; end: Date }>
        >`SELECT ${period.from}::date::timestamp AT TIME ZONE ${timezone} AS start, ${addDays(period.to, 1)}::date::timestamp AT TIME ZONE ${timezone} AS end`;
        const { start, end } = bounds[0]!;

        const tenants = targetTenantId
          ? Prisma.sql`AND t.id = ${targetTenantId}::uuid`
          : Prisma.empty;
        const search = query.search
          ? Prisma.sql`AND position(lower(${query.search}) in lower(t.name)) > 0`
          : Prisma.empty;
        const status = query.status
          ? Prisma.sql`AND t.status = ${query.status}`
          : Prisma.empty;
        const integration = query.integrationStatus
          ? Prisma.sql`AND (EXISTS(SELECT 1 FROM integrations i WHERE i.tenant_id=t.id AND i.status::text=${query.integrationStatus}) OR EXISTS(SELECT 1 FROM calendar_integrations i WHERE i.tenant_id=t.id AND i.status::text=${query.integrationStatus}))`
          : Prisma.empty;
        const activity = query.activeInPeriod
          ? Prisma.sql`AND ${query.activeInPeriod === 'false' ? Prisma.sql`NOT` : Prisma.empty} (EXISTS(SELECT 1 FROM messages m WHERE m.tenant_id=t.id AND m.created_at>=${start} AND m.created_at<${end}) OR EXISTS(SELECT 1 FROM appointments a WHERE a.tenant_id=t.id AND a.created_at>=${start} AND a.created_at<${end}) OR EXISTS(SELECT 1 FROM ai_usage a WHERE a.tenant_id=t.id AND a.created_at>=${start} AND a.created_at<${end}))`
          : Prisma.empty;
        const where = Prisma.sql`WHERE true ${tenants} ${search} ${status} ${integration} ${activity}`;
        const selectedIds = Prisma.sql`SELECT t.id FROM tenants t ${where}`;
        const scoped = Prisma.sql`AND tenant_id IN (${selectedIds})`;
        const summary = await tx.$queryRaw<
          Array<Record<string, number | null>>
        >(Prisma.sql`
        SELECT (SELECT count(*)::int FROM tenants t ${where}) tenants,
        (SELECT count(*)::int FROM tenants t ${where} AND t.status='ACTIVE') active,
        (SELECT count(*)::int FROM tenants t ${where} AND t.status='SUSPENDED') suspended,
        (SELECT count(DISTINCT ut.user_id)::int FROM user_tenants ut JOIN users u ON u.id=ut.user_id WHERE ut.active AND u.status='ACTIVE' AND ut.tenant_id IN (${selectedIds})) users,
        (SELECT count(*)::int FROM conversations WHERE created_at>=${start} AND created_at<${end} ${scoped}) conversations,
        (SELECT count(*)::int FROM messages WHERE created_at>=${start} AND created_at<${end} ${scoped}) messages,
        (SELECT count(*)::int FROM appointments WHERE created_at>=${start} AND created_at<${end} ${scoped}) appointments,
        (SELECT sum(total_tokens)::float8 FROM ai_usage WHERE created_at>=${start} AND created_at<${end} ${scoped}) tokens,
        (SELECT count(*)::int FROM units WHERE true ${scoped}) units,
        (SELECT count(DISTINCT ut.user_id)::int FROM user_tenants ut WHERE ut.tenant_id IN (${selectedIds})) "totalUsers",
        (SELECT count(*)::int FROM ai_usage WHERE created_at>=${start} AND created_at<${end} ${scoped}) "aiRequests",
        (SELECT count(*)::int FROM (SELECT tenant_id FROM integrations WHERE status IN('ERROR','DEGRADED') ${scoped} UNION ALL SELECT tenant_id FROM calendar_integrations WHERE status IN('ERROR','DEGRADED') ${scoped}) f) "failedIntegrations",
        (SELECT count(DISTINCT tenant_id)::int FROM (
          SELECT tenant_id FROM integrations WHERE status IN('ERROR','DEGRADED') ${scoped}
          UNION ALL SELECT tenant_id FROM calendar_integrations WHERE status IN('ERROR','DEGRADED') ${scoped}
          UNION ALL SELECT tenant_id FROM messages WHERE delivery_status='FAILED' AND created_at>=${start} AND created_at<${end} ${scoped}
          UNION ALL SELECT tenant_id FROM ai_usage WHERE status='ERROR' AND created_at>=${start} AND created_at<${end} ${scoped}
          UNION ALL SELECT tenant_id FROM calendar_sync_attempts WHERE status IN('RETRYABLE_ERROR','PERMANENT_ERROR') AND created_at>=${start} AND created_at<${end} ${scoped}
        ) incidents) "tenantsWithIncidents"`);

        const count = await tx.$queryRaw<Array<{ count: number }>>(
          Prisma.sql`SELECT count(*)::int count FROM tenants t ${where}`,
        );
        // Restrict aggregates to the selected page before grouping; no query per tenant.
        const clinics = await tx.$queryRaw<
          Array<{
            id: string;
            name: string;
            status: string;
            timezone: string;
            users: number;
            messages: number;
            conversations: number;
            appointments: number;
            tokens: number | null;
            lastActivity: Date | null;
          }>
        >(Prisma.sql`
        WITH selected AS (SELECT t.id,t.name,t.status,t.timezone,t.created_at AS "createdAt" FROM tenants t ${where} ORDER BY t.name,t.id LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}),
        m AS (SELECT tenant_id,count(*) FILTER(WHERE created_at>=${start} AND created_at<${end})::int n,max(created_at) last FROM messages WHERE tenant_id IN(SELECT id FROM selected) GROUP BY tenant_id),
        c AS (SELECT tenant_id,count(*)::int n FROM conversations WHERE tenant_id IN(SELECT id FROM selected) AND created_at>=${start} AND created_at<${end} GROUP BY tenant_id),
        a AS (SELECT tenant_id,count(*) FILTER(WHERE created_at>=${start} AND created_at<${end})::int n,max(created_at) last FROM appointments WHERE tenant_id IN(SELECT id FROM selected) GROUP BY tenant_id),
        ai AS (SELECT tenant_id,sum(total_tokens) FILTER(WHERE created_at>=${start} AND created_at<${end})::float8 tokens,max(created_at) last FROM ai_usage WHERE tenant_id IN(SELECT id FROM selected) GROUP BY tenant_id),
        u AS (SELECT ut.tenant_id,count(*)::int n FROM user_tenants ut JOIN users u ON u.id=ut.user_id WHERE ut.tenant_id IN(SELECT id FROM selected) AND ut.active AND u.status='ACTIVE' GROUP BY ut.tenant_id)
        SELECT s.*,coalesce(u.n,0) users,coalesce(m.n,0) messages,coalesce(c.n,0) conversations,coalesce(a.n,0) appointments,ai.tokens,
        greatest(m.last,a.last,ai.last) AS "lastActivity" FROM selected s LEFT JOIN m ON m.tenant_id=s.id LEFT JOIN c ON c.tenant_id=s.id LEFT JOIN a ON a.tenant_id=s.id LEFT JOIN ai ON ai.tenant_id=s.id LEFT JOIN u ON u.tenant_id=s.id ORDER BY s.name,s.id`);
        const planRows = await tx.$queryRaw<Array<{
          tenantId: string;
          planCode: string;
          subscriptionStatus: string;
          currentPeriodStart: Date;
          currentPeriodEnd: Date;
          graceUntil: Date | null;
          scheduledPlanCode: string | null;
          overrides: Prisma.JsonValue;
          aiRequests: number;
          aiTokens: number;
          unknownAiTokens: number;
          messagesInbound: number;
          messagesOutbound: number;
          appointmentsCreated: number;
          activeUsers: number;
          activeUnits: number;
          activeProviders: number;
          activeIntegrations: number;
          knowledgeArticles: number;
        }>>(Prisma.sql`
          WITH selected AS (
            SELECT t.id,s.plan_code,s.status,s.current_period_start,s.current_period_end,s.grace_until,s.scheduled_plan_code,s.overrides
            FROM tenants t JOIN tenant_subscriptions s ON s.tenant_id=t.id ${where}
            ORDER BY t.name,t.id LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
          ),
          ai AS (
            SELECT x.id tenant_id,count(a.id)::int requests,COALESCE(sum(a.total_tokens)::float8,0) tokens,
              count(a.id) FILTER(WHERE a.total_tokens IS NULL)::int unknown_tokens
            FROM selected x LEFT JOIN ai_usage a ON a.tenant_id=x.id AND a.created_at>=x.current_period_start AND a.created_at<x.current_period_end GROUP BY x.id
          ),
          msg AS (
            SELECT x.id tenant_id,count(m.id) FILTER(WHERE m.sender_type::text='PATIENT')::int inbound,
              count(m.id) FILTER(WHERE m.sender_type::text<>'PATIENT')::int outbound
            FROM selected x LEFT JOIN messages m ON m.tenant_id=x.id AND m.created_at>=x.current_period_start AND m.created_at<x.current_period_end GROUP BY x.id
          ),
          ap AS (
            SELECT x.id tenant_id,count(a.id)::int created FROM selected x LEFT JOIN appointments a ON a.tenant_id=x.id AND a.created_at>=x.current_period_start AND a.created_at<x.current_period_end GROUP BY x.id
          ),
          usr AS (
            SELECT x.id tenant_id,count(u.id)::int n FROM selected x LEFT JOIN user_tenants ut ON ut.tenant_id=x.id AND ut.active
              LEFT JOIN users u ON u.id=ut.user_id AND u.status='ACTIVE' GROUP BY x.id
          ),
          units AS (SELECT x.id tenant_id,count(u.id) FILTER(WHERE u.active)::int n FROM selected x LEFT JOIN units u ON u.tenant_id=x.id GROUP BY x.id),
          providers AS (SELECT x.id tenant_id,count(p.id) FILTER(WHERE p.active)::int n FROM selected x LEFT JOIN providers p ON p.tenant_id=x.id GROUP BY x.id),
          integrations AS (
            SELECT x.id tenant_id,
              (count(DISTINCT i.id) FILTER(WHERE i.status='ACTIVE') + count(DISTINCT ci.id) FILTER(WHERE ci.status='ACTIVE'))::int n
            FROM selected x LEFT JOIN integrations i ON i.tenant_id=x.id LEFT JOIN calendar_integrations ci ON ci.tenant_id=x.id GROUP BY x.id
          ),
          kb AS (SELECT x.id tenant_id,count(k.id) FILTER(WHERE k.status<>'INACTIVE')::int n FROM selected x LEFT JOIN knowledge_articles k ON k.tenant_id=x.id GROUP BY x.id)
          SELECT x.id AS "tenantId",x.plan_code AS "planCode",x.status::text AS "subscriptionStatus",
            x.current_period_start AS "currentPeriodStart",x.current_period_end AS "currentPeriodEnd",x.grace_until AS "graceUntil",
            x.scheduled_plan_code AS "scheduledPlanCode",x.overrides,
            COALESCE(ai.requests,0)::int "aiRequests",COALESCE(ai.tokens,0)::float8 "aiTokens",COALESCE(ai.unknown_tokens,0)::int "unknownAiTokens",
            COALESCE(msg.inbound,0)::int "messagesInbound",COALESCE(msg.outbound,0)::int "messagesOutbound",COALESCE(ap.created,0)::int "appointmentsCreated",
            COALESCE(usr.n,0)::int "activeUsers",COALESCE(units.n,0)::int "activeUnits",COALESCE(providers.n,0)::int "activeProviders",
            COALESCE(integrations.n,0)::int "activeIntegrations",COALESCE(kb.n,0)::int "knowledgeArticles"
          FROM selected x LEFT JOIN ai ON ai.tenant_id=x.id LEFT JOIN msg ON msg.tenant_id=x.id LEFT JOIN ap ON ap.tenant_id=x.id
          LEFT JOIN usr ON usr.tenant_id=x.id LEFT JOIN units ON units.tenant_id=x.id LEFT JOIN providers ON providers.tenant_id=x.id
          LEFT JOIN integrations ON integrations.tenant_id=x.id LEFT JOIN kb ON kb.tenant_id=x.id`);
        const planSummaries = new Map(planRows.map((row) => {
          const context = createPlanContext({
            planCode: row.planCode,
            status: row.subscriptionStatus,
            currentPeriodStart: row.currentPeriodStart,
            currentPeriodEnd: row.currentPeriodEnd,
            graceUntil: row.graceUntil,
            scheduledPlanCode: row.scheduledPlanCode,
            overrides: row.overrides,
          }, {
            AI_REQUESTS: row.aiRequests,
            AI_TOKENS: row.aiTokens,
            MESSAGES_INBOUND: row.messagesInbound,
            MESSAGES_OUTBOUND: row.messagesOutbound,
            APPOINTMENTS_CREATED: row.appointmentsCreated,
            ACTIVE_USERS: row.activeUsers,
            ACTIVE_UNITS: row.activeUnits,
            ACTIVE_PROVIDERS: row.activeProviders,
            ACTIVE_INTEGRATIONS: row.activeIntegrations,
            KNOWLEDGE_ARTICLES: row.knowledgeArticles,
            unknownAiTokenRequests: row.unknownAiTokens,
          } satisfies PlanUsageValues);
          const keyMetrics = context.usage.filter((metric) =>
            ['AI_TOKENS', 'MESSAGES_TOTAL', 'ACTIVE_USERS'].includes(metric.metric),
          );
          return [row.tenantId, {
            code: context.plan.code,
            name: context.plan.name,
            status: context.subscription.status,
            currentPeriodStart: context.subscription.currentPeriodStart,
            currentPeriodEnd: context.subscription.currentPeriodEnd,
            graceUntil: context.subscription.graceUntil,
            scheduledPlanCode: context.subscription.scheduledPlanCode,
            overLimit: context.subscription.overLimit,
            alertCount: context.alerts.length,
            keyMetrics,
          }];
        }));
        const clinicsWithPlans = clinics.map((clinic) => ({
          ...clinic,
          plan: planSummaries.get(clinic.id) ?? null,
        }));
        const usage = await tx.$queryRaw<
          Array<Record<string, string | number | null>>
        >(Prisma.sql`
        SELECT tenant_id AS "tenantId",provider,model,count(*)::int requests,
        count(*) FILTER(WHERE status='ERROR')::int errors,sum(input_tokens)::float8 "inputTokens",sum(output_tokens)::float8 "outputTokens",sum(total_tokens)::float8 "totalTokens",
        count(*) FILTER(WHERE total_tokens IS NULL)::int "unknownTokens",avg(latency_ms)::float8 "latencyMs",sum(attempts)::float8 attempts
        FROM ai_usage WHERE created_at>=${start} AND created_at<${end} ${scoped}
        GROUP BY tenant_id,provider,model ORDER BY count(*) DESC,tenant_id,provider,model LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`);
        const integrations = await tx.$queryRaw<
          Array<{
            tenantId: string;
            tenantName: string;
            type: string;
            status: string;
            updatedAt: Date;
            lastTestedAt: Date | null;
          }>
        >(Prisma.sql`
        SELECT i.id, i.tenant_id AS "tenantId",t.name AS "tenantName",'WHATSAPP' AS type,i.status::text,i.updated_at AS "updatedAt",null::timestamptz AS "lastTestedAt", CASE WHEN i.status='ERROR' THEN 'DELIVERY_ERROR' WHEN i.status='DEGRADED' THEN 'DELIVERY_DEGRADED' ELSE null END AS "errorCode" FROM integrations i JOIN tenants t ON t.id=i.tenant_id WHERE true AND i.tenant_id IN (${selectedIds})
        UNION ALL SELECT i.id,i.tenant_id,t.name,'GOOGLE_CALENDAR',i.status::text,i.updated_at,i.last_tested_at,CASE WHEN i.last_error_code IN('GOOGLE_UNAUTHORIZED','GOOGLE_FORBIDDEN','TOKEN_RESPONSE_INVALID','NETWORK_ERROR','AUTHENTICATION','AUTHORIZATION','RATE_LIMIT','TIMEOUT','UNAVAILABLE','INVALID_INPUT','NOT_FOUND','CONFIGURATION') THEN i.last_error_code WHEN i.last_error_code IS NOT NULL THEN 'SYNC_ERROR' ELSE null END FROM calendar_integrations i JOIN tenants t ON t.id=i.tenant_id WHERE true AND i.tenant_id IN (${selectedIds})
        ORDER BY status, "tenantId",type,id LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`);
        const incidents = await tx.$queryRaw<
          Array<{
            tenantId: string;
            type: string;
            severity: string;
            count: number;
          }>
        >(Prisma.sql`
        SELECT tenant_id AS "tenantId",'INTEGRATION' AS type,'CRITICAL' AS severity,count(*)::int count FROM (
          SELECT tenant_id FROM integrations WHERE status IN('ERROR','DEGRADED') ${scoped}
          UNION ALL SELECT tenant_id FROM calendar_integrations WHERE status IN('ERROR','DEGRADED') ${scoped}) i GROUP BY tenant_id
        UNION ALL SELECT tenant_id,'AI_ERROR','WARNING',count(*)::int FROM ai_usage WHERE status='ERROR' AND created_at>=${start} AND created_at<${end} ${scoped} GROUP BY tenant_id
        UNION ALL SELECT tenant_id,'MESSAGE_FAILED','CRITICAL',count(*)::int FROM messages WHERE delivery_status='FAILED' AND created_at>=${start} AND created_at<${end} ${scoped} GROUP BY tenant_id
        UNION ALL SELECT tenant_id,'CALENDAR_SYNC_ERROR','CRITICAL',count(*)::int FROM calendar_sync_attempts WHERE status IN('RETRYABLE_ERROR','PERMANENT_ERROR') AND created_at>=${start} AND created_at<${end} ${scoped} GROUP BY tenant_id
        ORDER BY severity,"tenantId",type LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`);
        const groups = await tx.$queryRaw<
          Array<{ kind: string; status: string; count: number }>
        >(Prisma.sql`
        SELECT 'conversation' AS kind,status::text,count(*)::int count FROM conversations WHERE created_at>=${start} AND created_at<${end} ${scoped} GROUP BY status
        UNION ALL SELECT 'appointment',status::text,count(*)::int FROM appointments WHERE created_at>=${start} AND created_at<${end} ${scoped} GROUP BY status
        UNION ALL SELECT 'sender',sender_type::text,count(*)::int FROM messages WHERE created_at>=${start} AND created_at<${end} ${scoped} GROUP BY sender_type
        UNION ALL SELECT 'delivery',delivery_status::text,count(*)::int FROM messages WHERE created_at>=${start} AND created_at<${end} ${scoped} GROUP BY delivery_status
        UNION ALL SELECT 'calendar',status::text,count(*)::int FROM calendar_sync_attempts WHERE created_at>=${start} AND created_at<${end} ${scoped} GROUP BY status
        UNION ALL SELECT 'role',ut.role,count(*)::int FROM user_tenants ut JOIN users u ON u.id=ut.user_id WHERE ut.active AND u.status='ACTIVE' AND ut.tenant_id IN (${selectedIds}) GROUP BY ut.role`);
        const series = await tx.$queryRaw<
          Array<{ date: string; kind: string; count: number }>
        >(Prisma.sql`
        SELECT to_char(created_at AT TIME ZONE ${timezone},'YYYY-MM-DD') AS date,'messages' AS kind,count(*)::int count FROM messages WHERE created_at>=${start} AND created_at<${end} ${scoped} GROUP BY 1
        UNION ALL SELECT to_char(created_at AT TIME ZONE ${timezone},'YYYY-MM-DD'),'conversations',count(*)::int FROM conversations WHERE created_at>=${start} AND created_at<${end} ${scoped} GROUP BY 1
        UNION ALL SELECT to_char(created_at AT TIME ZONE ${timezone},'YYYY-MM-DD'),'appointments',count(*)::int FROM appointments WHERE created_at>=${start} AND created_at<${end} ${scoped} GROUP BY 1
        UNION ALL SELECT to_char(created_at AT TIME ZONE ${timezone},'YYYY-MM-DD'),'ai',count(*)::int FROM ai_usage WHERE created_at>=${start} AND created_at<${end} ${scoped} GROUP BY 1 ORDER BY date,kind`);
        if (tenant)
          await recordAudit(tx, {
            data: {
              type: 'PLATFORM_TENANT_VIEWED',
              userId: scope.userId,
              tenantId: tenant.id,
              resourceId: tenant.id,
            },
          });
        return {
          period: { ...period, timezone },
          tenant,
          summary: summary[0]!,
          clinics: clinicsWithPlans,
          totalClinics: count[0]!.count,
          page: query.page,
          limit: query.limit,
          usage,
          integrations,
          incidents,
          groups,
          series,
          webhookErrors: null,
        };
      },
      { isolationLevel: 'RepeatableRead', timeout: 15000 },
    );
  }

  async changeSubscription(
    scope: PlatformScope,
    tenantId: string,
    change: SubscriptionChange,
  ) {
    return this.database.client.$transaction(
      async (tx) => {
        await requirePlatform(tx, scope);
        const tenant = await tx.tenant.findUnique({
          where: { id: tenantId },
          select: { id: true },
        });
        if (!tenant) throw new NotFoundException('Clínica não encontrada.');
        await tx.$queryRaw(Prisma.sql`SELECT tenant_id FROM tenant_subscriptions WHERE tenant_id=${tenantId}::uuid FOR UPDATE`);
        const before = await tx.tenantSubscription.findUnique({
          where: { tenantId },
        });
        if (!before) throw new NotFoundException('Plano não encontrado.');
        const immediatePlan =
          change.planCode && change.applyAt === 'NOW'
            ? change.planCode
            : before.planCode;
        const scheduledPlan =
          change.scheduledPlanCode !== undefined
            ? change.scheduledPlanCode
            : change.planCode && change.applyAt === 'NEXT_CYCLE'
              ? change.planCode
              : change.applyAt === 'NOW'
                ? null
                : before.scheduledPlanCode;
        const after = await tx.tenantSubscription.update({
          where: { tenantId },
          data: {
            planCode: immediatePlan,
            scheduledPlanCode: scheduledPlan,
            ...(change.status !== undefined ? { status: change.status } : {}),
            ...(change.graceUntil !== undefined ? { graceUntil: change.graceUntil } : {}),
            ...(change.overrides !== undefined ? { overrides: change.overrides as Prisma.InputJsonValue } : {}),
          },
        });
        if (before.planCode !== immediatePlan) {
          await recordAudit(tx, {
            data: {
              tenantId,
              userId: scope.userId,
              resourceId: tenantId,
              type: 'PLAN_CHANGED',
              changes: { before: { planCode: before.planCode }, after: { planCode: immediatePlan } },
            },
          });
          await recordAudit(tx, {
            data: {
              tenantId,
              userId: scope.userId,
              resourceId: tenantId,
              type: comparePlanRank(before.planCode, immediatePlan) > 0
                ? 'PLAN_UPGRADED'
                : 'PLAN_DOWNGRADED',
              changes: { before: { planCode: before.planCode }, after: { planCode: immediatePlan } },
            },
          });
        }
        if (before.scheduledPlanCode !== scheduledPlan)
          await recordAudit(tx, {
            data: {
              tenantId,
              userId: scope.userId,
              resourceId: tenantId,
              type: 'PLAN_CHANGED',
              changes: { before: { scheduledPlanCode: before.scheduledPlanCode }, after: { scheduledPlanCode: scheduledPlan } },
            },
          });
        if (JSON.stringify(before.overrides) !== JSON.stringify(after.overrides))
          await recordAudit(tx, {
            data: {
              tenantId,
              userId: scope.userId,
              resourceId: tenantId,
              type: 'PLAN_OVERRIDE_CHANGED',
              changes: { before: before.overrides, after: after.overrides },
            },
          });
        if (before.status !== after.status) {
          await recordAudit(tx, {
            data: {
              tenantId,
              userId: scope.userId,
              resourceId: tenantId,
              type: 'SUBSCRIPTION_STATUS_CHANGED',
              changes: { before: { status: before.status }, after: { status: after.status, graceUntil: after.graceUntil?.toISOString() ?? null } },
            },
          });
          if (after.status === 'GRACE')
            await recordAudit(tx, {
              data: { tenantId, userId: scope.userId, resourceId: tenantId, type: 'GRACE_STARTED' },
            });
          else if (before.status === 'GRACE')
            await recordAudit(tx, {
              data: { tenantId, userId: scope.userId, resourceId: tenantId, type: 'GRACE_ENDED' },
            });
        }
        return {
          planCode: after.planCode,
          status: after.status,
          currentPeriodStart: after.currentPeriodStart,
          currentPeriodEnd: after.currentPeriodEnd,
          graceUntil: after.graceUntil,
          scheduledPlanCode: after.scheduledPlanCode,
          overrides: after.overrides,
        };
      },
      { isolationLevel: 'Serializable' },
    );
  }
}
