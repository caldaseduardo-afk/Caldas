import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PermissionName, Prisma } from '@atendente/database';
import type { DatabaseService } from '../auth/database.service';
import {
  AuthorizationService,
  authorizedTenantFilter,
} from '../permissions/authorization.service';
import type { TenantScope } from '../tenancy/tenant.context';
import {
  dateText,
  timeText,
  type Pair,
  type AvailabilityFilter,
} from './availability.dto';
export const availabilityPermissions: [PermissionName, ...PermissionName[]] = [
  'provider.manage',
  'unit.view',
];
export const availabilityWhere = (scope: TenantScope) => ({
  tenantId: scope.tenantId,
  tenant: authorizedTenantFilter(scope, availabilityPermissions),
});
const baseFields = {
  id: true,
  providerId: true,
  unitId: true,
  active: true,
} as const;
export const ruleFields = {
  ...baseFields,
  weekday: true,
  startTime: true,
  endTime: true,
  validFrom: true,
  validUntil: true,
} as const;
export const exceptionFields = {
  ...baseFields,
  date: true,
  startTime: true,
  endTime: true,
  type: true,
  reason: true,
} as const;
export function presentRule<
  T extends {
    startTime: Date;
    endTime: Date;
    validFrom: Date;
    validUntil: Date | null;
  },
>(row: T) {
  return {
    ...row,
    startTime: timeText(row.startTime),
    endTime: timeText(row.endTime),
    validFrom: dateText(row.validFrom),
    validUntil: row.validUntil ? dateText(row.validUntil) : null,
  };
}
export function presentException<
  T extends { date: Date; startTime: Date | null; endTime: Date | null },
>(row: T) {
  return {
    ...row,
    date: dateText(row.date),
    startTime: row.startTime ? timeText(row.startTime) : null,
    endTime: row.endTime ? timeText(row.endTime) : null,
  };
}
export async function checkFilters(
  database: DatabaseService,
  scope: TenantScope,
  filter: AvailabilityFilter,
) {
  const where = availabilityWhere(scope);
  if (
    filter.providerId &&
    !(await database.client.provider.findFirst({
      where: { id: filter.providerId, ...where },
      select: { id: true },
    }))
  )
    throw new NotFoundException('Recurso não encontrado.');
  if (
    filter.unitId &&
    !(await database.client.unit.findFirst({
      where: { id: filter.unitId, ...where },
      select: { id: true },
    }))
  )
    throw new NotFoundException('Recurso não encontrado.');
}
export async function lockPair(
  tx: Prisma.TransactionClient,
  scope: TenantScope,
  pair: Pair,
  requireActive: boolean,
) {
  const [row] = await tx.providerUnit.updateManyAndReturn({
    where: {
      providerId: pair.providerId,
      unitId: pair.unitId,
      ...availabilityWhere(scope),
    },
    data: { updatedAt: new Date() },
    select: { active: true },
  });
  if (!row) throw new NotFoundException('Recurso não encontrado.');
  if (requireActive && !row.active)
    throw new ConflictException('Vínculo com unidade inativo.');
}
export async function availabilityWrite<T>(
  database: DatabaseService,
  authorization: AuthorizationService,
  execute: (tx: Prisma.TransactionClient, scope: TenantScope) => Promise<T>,
): Promise<T> {
  const scope = await authorization.requirePermissions(
    ...availabilityPermissions,
  );
  try {
    return await database.client.$transaction(
      async (tx) => {
        if (
          !(await tx.tenant.findFirst({
            where: authorizedTenantFilter(scope, availabilityPermissions),
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
      ['P2002', 'P2004', 'P2034'].includes(String(error.code))
    )
      throw new ConflictException(
        'Conflito de disponibilidade ou alteração concorrente. Atualize e tente novamente.',
      );
    throw error;
  }
}
