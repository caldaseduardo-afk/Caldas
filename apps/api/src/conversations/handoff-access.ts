import { OPERATIONAL_ROLES, type Prisma } from '@atendente/database';
import { replyPermissions } from './conversation-access';
export function eligibleAssignee(
  tenantId: string,
): Prisma.UserTenantWhereInput {
  return {
    tenantId,
    active: true,
    role: { in: [...OPERATIONAL_ROLES] },
    user: { status: 'ACTIVE', mfaEnabled: false, mfaRequired: false },
    roleDefinition: {
      enabled: true,
      AND: replyPermissions.map((permissionName) => ({
        permissions: { some: { permissionName } },
      })),
    },
  };
}
