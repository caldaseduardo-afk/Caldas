import type { PermissionName } from '@atendente/database';
import type { TenantScope } from '../tenancy/tenant.context';
import { authorizedTenantFilter } from '../permissions/authorization.service';
export const viewPermissions: [PermissionName, ...PermissionName[]] = [
  'conversation.view',
  'contact.view',
];
export const replyPermissions: [PermissionName, ...PermissionName[]] = [
  ...viewPermissions,
  'conversation.reply',
];
export const conversationWhere = (
  scope: TenantScope,
  permissions: readonly PermissionName[],
) => ({
  tenantId: scope.tenantId,
  tenant: authorizedTenantFilter(scope, permissions),
});
export const conversationFields = {
  integrationId: true,
  id: true,
  contactId: true,
  activePatientId: true,
  channel: true,
  status: true,
  intent: true,
  assignedUserId: true,
  handoffReason: true,
  handoffRequestedAt: true,
  slaLevel: true,
  assignedAt: true,
  resolvedAt: true,
  lastMessageAt: true,
  createdAt: true,
} as const;
export const messageFields = {
  deliveryStatus: true,
  errorCode: true,
  id: true,
  conversationId: true,
  senderType: true,
  senderUserId: true,
  messageType: true,
  content: true,
  metadata: true,
  createdAt: true,
  deliveredAt: true,
  readAt: true,
} as const;
export function pageResult<T>(rows: T[], page: number, limit: number) {
  return {
    items: rows.slice(0, limit),
    page,
    limit,
    hasMore: rows.length > limit,
  };
}
