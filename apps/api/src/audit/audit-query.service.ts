import { Injectable, NotFoundException } from '@nestjs/common';
import { sanitizeAudit } from '@atendente/database';
import type { Prisma } from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import {
  AuthorizationService,
  authorizedTenantFilter,
} from '../permissions/authorization.service';
import { auditQuery } from './audit.dto';
const fields = {
  id: true,
  type: true,
  actorType: true,
  userId: true,
  actorReferenceId: true,
  resourceType: true,
  resourceId: true,
  source: true,
  correlationId: true,
  createdAt: true,
  previousValues: true,
  newValues: true,
  metadata: true,
  changes: true,
} as const;
@Injectable()
export class AuditQueryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}
  private async where(): Promise<Prisma.AuthEventWhereInput> {
    const scope = await this.authorization.requirePermissions('audit.view');
    return {
      tenantId: scope.tenantId,
      isBusiness: true,
      tenant: authorizedTenantFilter(scope, ['audit.view']),
    };
  }
  async list(query: ReturnType<typeof auditQuery>) {
    const where: Prisma.AuthEventWhereInput = {
      ...(await this.where()),
      resourceType: query.resourceType,
      resourceId: query.resourceId,
      type: query.action,
      actorType: query.actorType,
      userId: query.actorUserId,
      source: query.source,
      correlationId: query.correlationId,
      createdAt: {
        gte: query.dateFrom ? new Date(query.dateFrom) : undefined,
        lte: query.dateTo ? new Date(query.dateTo) : undefined,
      },
    };
    const rows = await this.database.client.authEvent.findMany({
      where,
      select: fields,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit + 1,
    });
    return {
      items: rows.slice(0, query.limit).map(project),
      page: query.page,
      limit: query.limit,
      hasMore: rows.length > query.limit,
    };
  }
  async get(id: string) {
    const row = await this.database.client.authEvent.findFirst({
      where: { ...(await this.where()), id },
      select: fields,
    });
    if (!row) throw new NotFoundException('Recurso não encontrado.');
    return project(row);
  }
}
function project(row: Prisma.AuthEventGetPayload<{ select: typeof fields }>) {
  const { type, userId, changes, ...rest } = row;
  return {
    ...rest,
    action: type,
    actorUserId: userId,
    previousValues: sanitizeAudit(row.previousValues),
    newValues: sanitizeAudit(row.newValues),
    metadata: sanitizeAudit(row.metadata ?? changes),
  };
}
