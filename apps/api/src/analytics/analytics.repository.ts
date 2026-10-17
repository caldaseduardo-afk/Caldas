import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@atendente/database';
import type { DashboardResponse, DashboardOptions } from '@atendente/types';
import { DatabaseService } from '../auth/database.service';
import { authorizedTenantFilter } from '../permissions/authorization.service';
import type { TenantScope } from '../tenancy/tenant.context';
import type { DashboardQuery } from './analytics.dto';
import {
  addDays,
  civilPeriod,
  type AppointmentGroup,
} from './analytics.metrics';

export interface DashboardAggregates {
  period: DashboardResponse['period'];
  now: Date;
  appointments: AppointmentGroup[];
  conversations: DashboardResponse['conversations'];
  conversationSeries: DashboardResponse['conversationSeries'];
  current: DashboardResponse['current'];
  humanService: DashboardResponse['humanService'];
  conversion: { started: number; completed: number };
  rankings: DashboardResponse['rankings'];
}
@Injectable()
export class AnalyticsRepository {
  constructor(private readonly database: DatabaseService) {}
  private async tenant(tx: Prisma.TransactionClient, scope: TenantScope) {
    const tenant = await tx.tenant.findFirst({
      where: authorizedTenantFilter(scope, ['analytics.view']),
      select: { timezone: true },
    });
    if (!tenant) throw new ForbiddenException('Permissão insuficiente.');
    return tenant;
  }
  async options(
    scope: TenantScope,
    query: {
      kind: 'unit' | 'service' | 'provider';
      page: number;
      search: string;
    },
  ): Promise<DashboardOptions> {
    const where = {
      tenantId: scope.tenantId,
      tenant: authorizedTenantFilter(scope, ['analytics.view']),
      name: { contains: query.search, mode: 'insensitive' as const },
    };
    const args = {
      where,
      select: { id: true, name: true },
      take: 26,
      skip: (query.page - 1) * 25,
      orderBy: [{ name: 'asc' as const }, { id: 'asc' as const }],
    };
    const items =
      query.kind === 'unit'
        ? await this.database.client.unit.findMany(args)
        : query.kind === 'service'
          ? await this.database.client.service.findMany(args)
          : await this.database.client.provider.findMany(args);
    return {
      items: items.slice(0, 25),
      page: query.page,
      hasMore: items.length > 25,
    };
  }
  async aggregate(
    scope: TenantScope,
    query: DashboardQuery,
  ): Promise<DashboardAggregates> {
    if (!scope.tenantId) throw new ForbiddenException('Tenant obrigatório.');
    return this.database.client.$transaction(
      async (tx) => {
        const tenant = await this.tenant(tx, scope);
        let timezone = tenant.timezone;
        if (query.unitId) {
          const unit = await tx.unit.findFirst({
            where: { tenantId: scope.tenantId, id: query.unitId },
            select: { timezoneOverride: true },
          });
          if (!unit) throw new NotFoundException('Recurso não encontrado.');
          timezone = unit.timezoneOverride ?? timezone;
        }
        if (
          query.serviceId &&
          !(await tx.service.findFirst({
            where: { tenantId: scope.tenantId, id: query.serviceId },
            select: { id: true },
          }))
        )
          throw new NotFoundException('Recurso não encontrado.');
        if (
          query.providerId &&
          !(await tx.provider.findFirst({
            where: { tenantId: scope.tenantId, id: query.providerId },
            select: { id: true },
          }))
        )
          throw new NotFoundException('Recurso não encontrado.');
        const [{ now }] = await tx.$queryRaw<
          { now: Date }[]
        >`SELECT CURRENT_TIMESTAMP AS now`;
        const civil = civilPeriod(query, now, timezone);
        const [bounds] = await tx.$queryRaw<
          { startAt: Date; endAt: Date }[]
        >(Prisma.sql`
        SELECT ${civil.from}::date::timestamp AT TIME ZONE ${timezone} AS "startAt",
          ${addDays(civil.to, 1)}::date::timestamp AT TIME ZONE ${timezone} AS "endAt"`);
        const { startAt, endAt } = bounds,
          tenantId = scope.tenantId;
        const appointmentWhere = Prisma.sql`a.tenant_id = ${tenantId}::uuid AND a.start_at >= ${startAt} AND a.start_at < ${endAt} AND a.status <> 'RESCHEDULED'
        ${query.unitId ? Prisma.sql`AND a.unit_id = ${query.unitId}::uuid` : Prisma.empty}
        ${query.serviceId ? Prisma.sql`AND a.service_id = ${query.serviceId}::uuid` : Prisma.empty}
        ${query.providerId ? Prisma.sql`AND a.provider_id = ${query.providerId}::uuid` : Prisma.empty}`;
        const appointments = await tx.$queryRaw<AppointmentGroup[]>(Prisma.sql`
        SELECT to_char(a.start_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS date,
          a.status::text, a.source::text, count(*)::int AS count,
          count(*) FILTER (WHERE a.start_at <= ${now})::int AS past
        FROM appointments a WHERE ${appointmentWhere} GROUP BY 1, 2, 3 ORDER BY 1`);
        const rankings = await tx.$queryRaw<
          DashboardResponse['rankings']
        >(Prisma.sql`
        WITH counts AS (
          SELECT a.service_id, a.provider_id, a.unit_id, count(*)::int AS count
          FROM appointments a WHERE ${appointmentWhere}
          GROUP BY GROUPING SETS ((a.service_id), (a.provider_id), (a.unit_id))
        ), named AS (
          SELECT 'service' AS kind, s.id, s.name, c.count FROM counts c JOIN services s ON s.id=c.service_id AND s.tenant_id=${tenantId}::uuid
          UNION ALL SELECT 'provider', p.id, p.name, c.count FROM counts c JOIN providers p ON p.id=c.provider_id AND p.tenant_id=${tenantId}::uuid
          UNION ALL SELECT 'unit', u.id, u.name, c.count FROM counts c JOIN units u ON u.id=c.unit_id AND u.tenant_id=${tenantId}::uuid
        ), ranked AS (SELECT *, row_number() OVER (PARTITION BY kind ORDER BY count DESC, name, id) AS position FROM named)
        SELECT kind, id, name, count FROM ranked WHERE position <= 5 ORDER BY kind, position`);
        const [conversations] = await tx.$queryRaw<
          DashboardResponse['conversations'][]
        >(Prisma.sql`
        SELECT count(DISTINCT conversation_id)::int AS total, count(*)::int AS messages,
          count(*) FILTER (WHERE sender_type='AI')::int AS "aiMessages",
          count(*) FILTER (WHERE sender_type='USER')::int AS "humanMessages", 0::int AS handoffs
        FROM messages WHERE tenant_id=${tenantId}::uuid AND created_at >= ${startAt} AND created_at < ${endAt}`);
        const conversationSeries = await tx.$queryRaw<
          DashboardResponse['conversationSeries']
        >(Prisma.sql`
        WITH messages_daily AS (
          SELECT to_char(created_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS date,
            count(DISTINCT conversation_id)::int AS total, count(*)::int AS messages,
            count(*) FILTER (WHERE sender_type='AI')::int AS "aiMessages", count(*) FILTER (WHERE sender_type='USER')::int AS "humanMessages"
          FROM messages WHERE tenant_id=${tenantId}::uuid AND created_at >= ${startAt} AND created_at < ${endAt} GROUP BY 1
        ), handoffs AS (
          SELECT to_char(created_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS date, count(*)::int AS handoffs
          FROM auth_events WHERE tenant_id=${tenantId}::uuid AND type='HUMAN_HANDOFF_REQUESTED' AND created_at >= ${startAt} AND created_at < ${endAt} GROUP BY 1
        ) SELECT coalesce(m.date,h.date) AS date, coalesce(m.total,0) AS total, coalesce(m.messages,0) AS messages,
          coalesce(m."aiMessages",0) AS "aiMessages", coalesce(m."humanMessages",0) AS "humanMessages", coalesce(h.handoffs,0) AS handoffs
          FROM messages_daily m FULL JOIN handoffs h ON m.date=h.date ORDER BY 1`);
        conversations.handoffs = conversationSeries.reduce(
          (n, r) => n + r.handoffs,
          0,
        );
        const [current] = await tx.$queryRaw<
          DashboardResponse['current'][]
        >(Prisma.sql`
        SELECT count(*) FILTER (WHERE status='AI_ACTIVE')::int AS "aiActive",
          count(*) FILTER (WHERE status='WAITING_PATIENT')::int AS "waitingPatient",
          count(*) FILTER (WHERE status='NEEDS_HUMAN')::int AS "needsHuman",
          count(*) FILTER (WHERE status='HUMAN_ACTIVE')::int AS "humanActive",
          count(*) FILTER (WHERE status='RESOLVED')::int AS resolved,
          count(*) FILTER (WHERE status='CLOSED')::int AS closed,
          count(*) FILTER (WHERE status='NEEDS_HUMAN' AND sla_level='FIRST')::int AS "firstAlert",
          count(*) FILTER (WHERE status='NEEDS_HUMAN' AND sla_level='SECOND')::int AS "secondAlert",
          count(*) FILTER (WHERE status='NEEDS_HUMAN' AND sla_level='EXTERNAL')::int AS "externalAlert"
        FROM conversations WHERE tenant_id=${tenantId}::uuid`);
        const [humanService] = await tx.$queryRaw<
          DashboardResponse['humanService'][]
        >(Prisma.sql`
        SELECT avg(extract(epoch FROM (claimed_at-requested_at)))::float8 AS "avgResponseSeconds", count(*)::int AS "claimedCycles",
          (SELECT count(DISTINCT changes->>'cycleId')::int FROM auth_events
            WHERE tenant_id=${tenantId}::uuid AND type IN ('HUMAN_SLA_FIRST_ALERT','HUMAN_SLA_SECOND_ALERT','HUMAN_SLA_EXTERNAL_ALERT_REQUIRED')
            AND created_at >= ${startAt} AND created_at < ${endAt}) AS violations
        FROM human_sla_cycles WHERE tenant_id=${tenantId}::uuid AND claimed_at >= ${startAt} AND claimed_at < ${endAt} AND claimed_at >= requested_at`);
        const [conversion] = await tx.$queryRaw<
          { started: number; completed: number }[]
        >(Prisma.sql`
        WITH starts AS (
          SELECT e.id, e.resource_id, e.created_at, e.changes,
            (SELECT n.created_at FROM auth_events n WHERE n.tenant_id=${tenantId}::uuid
              AND n.resource_id=e.resource_id AND n.type='SCHEDULING_WORKFLOW_STARTED'
              AND (n.created_at,n.id) > (e.created_at,e.id) ORDER BY n.created_at,n.id LIMIT 1) AS next_start
          FROM auth_events e WHERE e.tenant_id=${tenantId}::uuid AND e.type='SCHEDULING_WORKFLOW_STARTED'
            AND e.created_at >= ${startAt} AND e.created_at < ${endAt}
        ) SELECT count(*)::int AS started, count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM auth_events e JOIN appointments a ON a.id=CASE WHEN e.changes->>'appointmentId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (e.changes->>'appointmentId')::uuid END AND a.tenant_id=${tenantId}::uuid AND a.source='WHATSAPP_AI'
          WHERE e.tenant_id=${tenantId}::uuid AND e.resource_id=s.resource_id AND e.type='SCHEDULING_WORKFLOW_COMPLETED'
            AND e.created_at >= s.created_at AND (s.next_start IS NULL OR e.created_at < s.next_start)
        ))::int AS completed FROM starts s WHERE s.created_at >= ${startAt} AND s.created_at < ${endAt}
          AND coalesce(s.changes->>'workflowType','SCHEDULING')='SCHEDULING'`);
        return {
          period: {
            ...civil,
            startAt: startAt.toISOString(),
            endAt: endAt.toISOString(),
            timezone,
          },
          now,
          appointments,
          rankings,
          conversations,
          conversationSeries,
          current,
          humanService,
          conversion,
        };
      },
      { isolationLevel: 'RepeatableRead', timeout: 15000 },
    );
  }
}
