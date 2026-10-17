import { eligibleAssignee } from '../conversations/handoff-access';
import { messageQuery } from '../conversations/conversation.dto';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PermissionName, Prisma } from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import { authorizedTenantFilter } from '../permissions/authorization.service';
import type { TenantScope } from '../tenancy/tenant.context';
import {
  conversationWhere,
  viewPermissions,
  pageResult,
} from '../conversations/conversation-access';
import { inboxQuery, historyQuery } from './inbox.dto';

const summary = {
  integrationId: true,
  id: true,
  channel: true,
  status: true,
  intent: true,
  lastMessageAt: true,
  assignedUserId: true,
  handoffReason: true,
  handoffRequestedAt: true,
  slaLevel: true,
  assignedAt: true,
  resolvedAt: true,
  contact: {
    select: {
      id: true,
      displayName: true,
      channels: {
        orderBy: [{ primary: 'desc' }, { id: 'asc' }],
        take: 1,
        select: { address: true, type: true },
      },
    },
  },
  assignedUser: { select: { user: { select: { name: true } } } },
  messages: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: { content: true, messageType: true },
  },
} satisfies Prisma.ConversationSelect;

@Injectable()
export class InboxRepository {
  constructor(private readonly database: DatabaseService) {}
  private async allowed(scope: TenantScope, permission: PermissionName) {
    return !!(await this.database.client.tenant.findFirst({
      where: authorizedTenantFilter(scope, [...viewPermissions, permission]),
      select: { id: true },
    }));
  }
  async session(scope: TenantScope) {
    const tenant = await this.database.client.tenant.findFirst({
      where: authorizedTenantFilter(scope, viewPermissions),
      select: { id: true, name: true, timezone: true },
    });
    if (!tenant) throw new ForbiddenException();
    const [
      canReply,
      canViewPatients,
      canViewAppointments,
      canAssign,
      canTransfer,
      canClose,
    ] = await Promise.all(
      [
        'conversation.reply',
        'patient.view',
        'appointment.view',
        'conversation.assign',
        'conversation.transfer',
        'conversation.close',
      ].map((p) => this.allowed(scope, p as PermissionName)),
    );
    return {
      tenant,
      userId: scope.userId,
      canReply,
      canViewPatients,
      canViewAppointments,
      canAssign,
      canTransfer,
      canClose,
    };
  }
  async assignees(scope: TenantScope, query: ReturnType<typeof messageQuery>) {
    const rows = await this.database.client.userTenant.findMany({
      where: {
        ...eligibleAssignee(scope.tenantId),
        tenant: authorizedTenantFilter(scope, [
          ...viewPermissions,
          'conversation.transfer',
        ]),
      },
      select: { user: { select: { id: true, name: true } } },
      orderBy: [{ user: { name: 'asc' } }, { userId: 'asc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit + 1,
    });
    return pageResult(
      rows.map((r) => r.user),
      query.page,
      query.limit,
    );
  }
  // Sensitive optional projections have their own permission predicates, including
  // after the initial service authorization; no role matrix is trusted by the UI.
  private patients(scope: TenantScope, ids: string[]) {
    return this.database.client.conversation.findMany({
      where: {
        ...conversationWhere(scope, [...viewPermissions, 'patient.view']),
        id: { in: ids },
      },
      select: { id: true, activePatient: { select: { id: true, name: true } } },
    });
  }
  async list(scope: TenantScope, query: ReturnType<typeof inboxQuery>) {
    const { q, status, page, limit } = query;
    const digits = /^[+\d ().-]+$/.test(q) ? q.replace(/\D/g, '') : '';
    const search: Prisma.ConversationWhereInput[] = [
      { contact: { displayName: { contains: q, mode: 'insensitive' } } },
      ...(digits
        ? [
            {
              contact: {
                channels: {
                  some: {
                    tenantId: scope.tenantId,
                    address: { contains: digits },
                  },
                },
              },
            },
          ]
        : []),
      {
        AND: [
          {
            tenant: authorizedTenantFilter(scope, [
              ...viewPermissions,
              'patient.view',
            ]),
          },
          { activePatient: { name: { contains: q, mode: 'insensitive' } } },
        ],
      },
    ];
    const rows = await this.database.client.conversation.findMany({
      where: {
        ...conversationWhere(scope, viewPermissions),
        ...(status ? { status } : {}),
        ...(q ? { OR: search } : {}),
      },
      select: summary,
      orderBy:
        status === 'NEEDS_HUMAN'
          ? [{ handoffRequestedAt: 'asc' }, { id: 'asc' }]
          : [
              { lastMessageAt: { sort: 'desc', nulls: 'last' } },
              { createdAt: 'desc' },
              { id: 'desc' },
            ],
      skip: (page - 1) * limit,
      take: limit + 1,
    });
    const patients = new Map(
      (
        await this.patients(
          scope,
          rows.map((r) => r.id),
        )
      ).map((r) => [r.id, r.activePatient]),
    );
    return pageResult(
      rows.map((row) => ({
        ...row,
        activePatient: patients.get(row.id) ?? null,
      })),
      page,
      limit,
    );
  }
  async detail(scope: TenantScope, id: string) {
    const row = await this.database.client.conversation.findFirst({
      where: { id, ...conversationWhere(scope, viewPermissions) },
      select: summary,
    });
    if (!row) throw new NotFoundException('Conversa indisponível.');
    const activePatient =
      (await this.patients(scope, [id]))[0]?.activePatient ?? null;
    const links = await this.database.client.contactPatient.findMany({
      where: {
        tenantId: scope.tenantId,
        contactId: row.contact.id,
        tenant: authorizedTenantFilter(scope, [
          ...viewPermissions,
          'patient.view',
        ]),
        active: true,
      },
      select: {
        patient: { select: { id: true, name: true } },
        relationshipType: true,
        relationshipStatus: true,
        authorizationLevel: true,
      },
      orderBy: { id: 'asc' },
      take: 100,
    });
    const appointment = activePatient
      ? await this.database.client.appointment.findFirst({
          where: {
            tenantId: scope.tenantId,
            patientId: activePatient.id,
            tenant: authorizedTenantFilter(scope, [
              ...viewPermissions,
              'patient.view',
              'appointment.view',
            ]),
            startAt: { gte: new Date() },
            status: { in: ['PENDING_CONFIRMATION', 'CONFIRMED'] },
          },
          select: {
            startAt: true,
            status: true,
            service: { select: { name: true } },
            provider: { select: { name: true } },
            unit: {
              select: {
                name: true,
                timezoneOverride: true,
                tenant: { select: { timezone: true } },
              },
            },
          },
          orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
        })
      : null;
    return {
      ...row,
      activePatient,
      links,
      appointment: appointment
        ? {
            startAt: appointment.startAt,
            status: appointment.status,
            service: appointment.service.name,
            provider: appointment.provider.name,
            unit: appointment.unit.name,
            timezone:
              appointment.unit.timezoneOverride ??
              appointment.unit.tenant.timezone,
          }
        : null,
    };
  }
  async history(
    scope: TenantScope,
    id: string,
    query: ReturnType<typeof historyQuery>,
  ) {
    const where = {
      tenantId: scope.tenantId,
      conversationId: id,
      conversation: conversationWhere(scope, viewPermissions),
    };
    if (
      !(await this.database.client.conversation.findFirst({
        where: { id, ...conversationWhere(scope, viewPermissions) },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Conversa indisponível.');
    const cursor = query.before
      ? await this.database.client.message.findFirst({
          where: { ...where, id: query.before },
          select: { id: true, createdAt: true },
        })
      : null;
    if (query.before && !cursor)
      throw new NotFoundException('Mensagem indisponível.');
    const rows = await this.database.client.message.findMany({
      where: {
        ...where,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        senderType: true,
        senderUser: { select: { user: { select: { name: true } } } },
        messageType: true,
        content: true,
        deliveryStatus: true,
        errorCode: true,
        deliveredAt: true,
        readAt: true,
        metadata: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const items = rows
      .slice(0, query.limit)
      .reverse()
      .map(({ metadata, ...row }) => {
        // mediaRef is not a public URL. Only presentation metadata leaves this endpoint.
        const safe: Record<string, string | number> = {};
        if (
          metadata &&
          typeof metadata === 'object' &&
          !Array.isArray(metadata)
        )
          for (const key of [
            'fileName',
            'mimeType',
            'sizeBytes',
            'latitude',
            'longitude',
            'label',
            'displayName',
            'phone',
            'selectionId',
          ]) {
            const value = metadata[key];
            if (typeof value === 'string' || typeof value === 'number')
              safe[key] = value;
          }
        return { ...row, metadata: safe };
      });
    return { items, before: rows.length > query.limit ? items[0]?.id : null };
  }
}
