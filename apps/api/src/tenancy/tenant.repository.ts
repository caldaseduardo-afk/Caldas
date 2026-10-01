import {
  AuthorizationService,
  authorizedTenantFilter,
} from '../permissions/authorization.service';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../auth/database.service';
import { TenantContext, enabledUser } from './tenant.context';

const tenantFields = { id: true, name: true, timezone: true } as const;

@Injectable()
export class TenantRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly context: TenantContext,
    private readonly authorization: AuthorizationService,
  ) {}

  async listAvailable() {
    const { userId, sessionId } = this.context.requireIdentity();
    return this.database.client.tenant.findMany({
      where: {
        status: 'ACTIVE',
        memberships: {
          some: {
            userId,
            active: true,
            user: {
              ...enabledUser,
              sessions: {
                some: { id: sessionId, expiresAt: { gt: new Date() } },
              },
            },
          },
        },
      },
      select: tenantFields,
      orderBy: { id: 'asc' },
    });
  }

  async select(tenantId: string) {
    const { userId, sessionId } = this.context.requireIdentity();
    return this.database.client.$transaction(async (tx) => {
      // A autorização faz parte do UPDATE, não apenas de uma leitura anterior.
      const changed = await tx.authSession.updateMany({
        where: {
          id: sessionId,
          userId,
          expiresAt: { gt: new Date() },
          user: {
            ...enabledUser,
            memberships: {
              some: { tenantId, active: true, tenant: { status: 'ACTIVE' } },
            },
          },
        },
        data: { activeTenantId: tenantId },
      });
      if (changed.count !== 1)
        throw new ForbiddenException('Tenant indisponível para esta sessão.');
      await tx.authEvent.create({
        data: { type: 'TENANT_SELECTED', userId, tenantId },
      });
      return { tenantId };
    });
  }

  async current() {
    const scope = await this.authorization.requirePermissions('tenant.view');
    const tenant = await this.database.client.tenant.findFirst({
      where: authorizedTenantFilter(scope, ['tenant.view']),
      select: tenantFields,
    });
    if (!tenant)
      throw new ForbiddenException('Tenant indisponível para esta sessão.');
    return tenant;
  }
}
