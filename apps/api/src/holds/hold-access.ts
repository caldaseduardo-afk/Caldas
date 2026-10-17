import type { PermissionName } from '@atendente/database';
import type { TenantScope } from '../tenancy/tenant.context';
import { authorizedTenantFilter } from '../permissions/authorization.service';
export const createPermissions: [PermissionName, ...PermissionName[]] = [
  'appointment.create',
  'patient.view',
  'unit.view',
];
export const readPermissions: [PermissionName, ...PermissionName[]] = [
  'appointment.view',
  'patient.view',
];
export const releasePermissions: [PermissionName, ...PermissionName[]] = [
  'appointment.cancel',
  'patient.view',
];
export const holdWhere = (
  scope: TenantScope,
  permissions: readonly PermissionName[],
) => ({
  tenantId: scope.tenantId,
  tenant: authorizedTenantFilter(scope, permissions),
});
export const holdFields = {
  id: true,
  patientId: true,
  contactId: true,
  serviceId: true,
  providerId: true,
  unitId: true,
  startAt: true,
  endAt: true,
  expiresAt: true,
  status: true,
} as const;
export function effectiveHold<T extends { status: string; expiresAt: Date }>(
  row: T,
  now: Date,
) {
  return {
    ...row,
    status:
      row.status === 'ACTIVE' && row.expiresAt <= now ? 'EXPIRED' : row.status,
  };
}
