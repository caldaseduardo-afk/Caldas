import { auditActorContext } from '@atendente/database';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  OPERATIONAL_ROLES,
  PERMISSIONS,
  type PermissionName,
  type Prisma,
} from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import {
  TenantContext,
  scopedTenantFilter,
  type TenantScope,
} from '../tenancy/tenant.context';

const enginePermissions = new Set<PermissionName>([
  'settings.manage',
  'settings.view',
  'conversation.view',
  'conversation.reply',
  'contact.view',
  'patient.view',
  'appointment.view',
  'appointment.create',
  'appointment.cancel',
  'appointment.reschedule',
  'unit.view',
  'knowledge.view',
]);
const engineScopes = new Map<
  string,
  { tenantId: string; actorId: string; references: number }
>();
const engineContext = new AsyncLocalStorage<TenantScope>();

export interface ConversationEngineGrant {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly runId: string;
  readonly leaseOwnerId: string;
}

export function isConversationEngineScope(scope: TenantScope) {
  const entry = engineScopes.get(scope.sessionId);
  return (
    !!entry &&
    entry.tenantId === scope.tenantId &&
    entry.actorId === scope.userId
  );
}

// Repetido na consulta ao recurso: uma checagem anterior não é autorização durável.
export function authorizedTenantFilter(
  scope: TenantScope,
  permissions: readonly PermissionName[],
): Prisma.TenantWhereInput {
  if (!permissions.length || permissions.some((p) => !PERMISSIONS.includes(p)))
    throw new ForbiddenException('Permissão inválida.');
  if (isConversationEngineScope(scope)) {
    if (permissions.some((permission) => !enginePermissions.has(permission)))
      throw new ForbiddenException('Permissão insuficiente.');
    return { id: scope.tenantId, status: 'ACTIVE' };
  }
  return {
    AND: [
      scopedTenantFilter(scope),
      {
        memberships: {
          some: {
            userId: scope.userId,
            active: true,
            role: { in: [...OPERATIONAL_ROLES] },
            roleDefinition: {
              enabled: true,
              AND: permissions.map((permissionName) => ({
                permissions: { some: { permissionName } },
              })),
            },
          },
        },
      },
    ],
  };
}

@Injectable()
export class AuthorizationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly context: TenantContext,
  ) {}

  async requirePermissions(
    ...permissions: PermissionName[]
  ): Promise<TenantScope> {
    const internal = engineContext.getStore();
    const scope = internal ?? (await this.context.requireTenant());
    const allowed = await this.database.client.tenant.findFirst({
      where: authorizedTenantFilter(scope, permissions),
      select: { id: true },
    });
    if (!allowed) throw new ForbiddenException('Permissão insuficiente.');
    return scope;
  }

  /** Application-only capability. The grant is revalidated and is never accepted by a controller. */
  async runAsConversationEngine<T>(
    grant: ConversationEngineGrant,
    callback: () => Promise<T>,
  ): Promise<T> {
    const now = new Date();
    const admitted = await this.database.client.aIProcessingRun.findFirst({
      where: {
        id: grant.runId,
        tenantId: grant.tenantId,
        conversationId: grant.conversationId,
        status: 'PROCESSING',
        tenant: { status: 'ACTIVE' },
        conversation: {
          status: 'AI_ACTIVE',
          engineLease: {
            ownerId: grant.leaseOwnerId,
            expiresAt: { gt: now },
          },
        },
      },
      select: { id: true },
    });
    if (!admitted)
      throw new ForbiddenException('Run do conversation engine inválido.');
    const scope = Object.freeze({
      tenantId: grant.tenantId,
      userId: grant.runId,
      sessionId: grant.leaseOwnerId,
    });
    const current = engineScopes.get(scope.sessionId);
    if (
      current &&
      (current.tenantId !== scope.tenantId || current.actorId !== scope.userId)
    )
      throw new ForbiddenException('Escopo interno em conflito.');
    engineScopes.set(scope.sessionId, {
      tenantId: scope.tenantId,
      actorId: scope.userId,
      references: (current?.references ?? 0) + 1,
    });
    try {
      return await auditActorContext.run({ tenantId: grant.tenantId, actorType: 'AI', source: 'AI_ENGINE', actorReferenceId: grant.conversationId, correlationId: grant.runId }, () => engineContext.run(scope, callback));
    } finally {
      const entry = engineScopes.get(scope.sessionId);
      if (!entry || entry.references <= 1) engineScopes.delete(scope.sessionId);
      else
        engineScopes.set(scope.sessionId, {
          ...entry,
          references: entry.references - 1,
        });
    }
  }
}
