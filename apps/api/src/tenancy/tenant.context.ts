import {
  ForbiddenException,
  Inject,
  Injectable,
  Scope,
  UnauthorizedException,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Prisma } from '@atendente/database';
import type { AuthRequest } from '../auth/auth.guard';
import { DatabaseService } from '../auth/database.service';

export interface TenantScope {
  readonly userId: string;
  readonly sessionId: string;
  readonly tenantId: string;
}
export const enabledUser = {
  status: 'ACTIVE' as const,
  mfaEnabled: false,
  mfaRequired: false,
};

export function scopedTenantFilter(
  scope: TenantScope,
): Prisma.TenantWhereInput {
  return {
    id: scope.tenantId,
    status: 'ACTIVE',
    memberships: {
      some: {
        userId: scope.userId,
        active: true,
        sessions: {
          some: {
            id: scope.sessionId,
            userId: scope.userId,
            activeTenantId: scope.tenantId,
            expiresAt: { gt: new Date() },
            user: enabledUser,
          },
        },
      },
    },
  };
}

@Injectable({ scope: Scope.REQUEST })
export class TenantContext {
  constructor(
    @Inject(REQUEST) private readonly request: AuthRequest,
    private readonly database: DatabaseService,
  ) {}

  requireIdentity() {
    if (!this.request.identity || !this.request.sessionId)
      throw new UnauthorizedException();
    return {
      userId: this.request.identity.id,
      sessionId: this.request.sessionId,
    };
  }

  async requireTenant(): Promise<TenantScope> {
    const identity = this.requireIdentity();
    const tenantId = this.request.activeTenantId;
    if (!tenantId)
      throw new ForbiddenException('Selecione um tenant disponível.');
    const scope = Object.freeze({ ...identity, tenantId });
    const tenant = await this.database.client.tenant.findFirst({
      where: scopedTenantFilter(scope),
      select: { id: true },
    });
    if (!tenant)
      throw new ForbiddenException('Tenant indisponível para esta sessão.');
    return scope;
  }
}
