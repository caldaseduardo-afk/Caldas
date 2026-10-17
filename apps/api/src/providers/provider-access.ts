import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { PermissionName, Prisma } from '@atendente/database';
import type { DatabaseService } from '../auth/database.service';
import {
  AuthorizationService,
  authorizedTenantFilter,
} from '../permissions/authorization.service';
import type { TenantScope } from '../tenancy/tenant.context';
export const providerPermissions: [PermissionName, ...PermissionName[]] = [
  'provider.manage',
];
export const providerServicePermissions: [PermissionName, ...PermissionName[]] =
  ['provider.manage', 'service.manage'];
export const providerUnitPermissions: [PermissionName, ...PermissionName[]] = [
  'provider.manage',
  'unit.view',
];
export const providerWhere = (
  scope: TenantScope,
  permissions = providerPermissions,
) => ({
  tenantId: scope.tenantId,
  tenant: authorizedTenantFilter(scope, permissions),
});
export const providerSummary = {
  id: true,
  name: true,
  professionalType: true,
  active: true,
} as const;
export const providerFields = {
  ...providerSummary,
  registrationNumber: true,
} as const;
export const providerServiceFields = {
  id: true,
  providerId: true,
  serviceId: true,
  durationOverrideMinutes: true,
  priceOverride: true,
  active: true,
  service: {
    select: {
      id: true,
      name: true,
      active: true,
      durationMinutes: true,
      price: true,
    },
  },
} as const;
export const providerUnitFields = {
  id: true,
  providerId: true,
  unitId: true,
  active: true,
  unit: { select: { id: true, name: true, active: true } },
} as const;
type DecimalValue = { toFixed: (digits: number) => string } | null;
export function presentProviderService<
  T extends { priceOverride: DecimalValue; service: { price: DecimalValue } },
>(row: T) {
  return {
    ...row,
    priceOverride: row.priceOverride?.toFixed(2) ?? null,
    service: { ...row.service, price: row.service.price?.toFixed(2) ?? null },
  };
}
export async function providerWrite<T>(
  database: DatabaseService,
  authorization: AuthorizationService,
  permissions: PermissionName[],
  execute: (tx: Prisma.TransactionClient, scope: TenantScope) => Promise<T>,
): Promise<T> {
  const scope = await authorization.requirePermissions(...permissions);
  try {
    return await database.client.$transaction(
      async (tx) => {
        if (
          !(await tx.tenant.findFirst({
            where: authorizedTenantFilter(scope, permissions),
            select: { id: true },
          }))
        )
          throw new ForbiddenException('Permissão insuficiente.');
        return execute(tx, scope);
      },
      { isolationLevel: 'Serializable' },
    );
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      ['P2002', 'P2034'].includes(String(error.code))
    )
      throw new ConflictException(
        'Vínculo existente ou alteração concorrente. Atualize e tente novamente.',
      );
    throw error;
  }
}
