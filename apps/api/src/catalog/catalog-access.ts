import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@atendente/database';
import type { DatabaseService } from '../auth/database.service';
import {
  AuthorizationService,
  authorizedTenantFilter,
} from '../permissions/authorization.service';
import type { TenantScope } from '../tenancy/tenant.context';
export const catalogWhere = (scope: TenantScope) => ({
  tenantId: scope.tenantId,
  tenant: authorizedTenantFilter(scope, ['service.manage']),
});
export const specialtyFields = {
  id: true,
  name: true,
  description: true,
  active: true,
} as const;
export const serviceFields = {
  ...specialtyFields,
  specialtyId: true,
  durationMinutes: true,
  bufferBeforeMinutes: true,
  bufferAfterMinutes: true,
  price: true,
} as const;
export function presentService<
  T extends { price: { toFixed: (n: number) => string } | null },
>(row: T) {
  return { ...row, price: row.price?.toFixed(2) ?? null };
}
export async function catalogWrite<T>(
  database: DatabaseService,
  authorization: AuthorizationService,
  execute: (tx: Prisma.TransactionClient, scope: TenantScope) => Promise<T>,
): Promise<T> {
  const scope = await authorization.requirePermissions('service.manage');
  try {
    return await database.client.$transaction(
      async (tx) => {
        if (
          !(await tx.tenant.findFirst({
            where: authorizedTenantFilter(scope, ['service.manage']),
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
        'Nome existente ou alteração concorrente. Atualize e tente novamente.',
      );
    throw error;
  }
}
