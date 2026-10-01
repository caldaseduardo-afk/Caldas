import { ForbiddenException, Injectable } from '@nestjs/common';
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

// Repetido na consulta ao recurso: uma checagem anterior não é autorização durável.
export function authorizedTenantFilter(
  scope: TenantScope,
  permissions: readonly PermissionName[],
): Prisma.TenantWhereInput {
  if (!permissions.length || permissions.some((p) => !PERMISSIONS.includes(p)))
    throw new ForbiddenException('Permissão inválida.');
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
    const scope = await this.context.requireTenant();
    const allowed = await this.database.client.tenant.findFirst({
      where: authorizedTenantFilter(scope, permissions),
      select: { id: true },
    });
    if (!allowed) throw new ForbiddenException('Permissão insuficiente.');
    return scope;
  }
}
