// Catálogo do backend. Não substitui escopo de tenant/unidade/paciente.
export const PERMISSIONS = [
  'audit.view',
  'tenant.view',
  'unit.view',
  'contact.view',
  'contact.edit',
  'conversation.view',
  'conversation.reply',
  'conversation.assign',
  'conversation.transfer',
  'conversation.close',
  'patient.view',
  'patient.edit',
  'patient.authorize',
  'appointment.view',
  'appointment.create',
  'appointment.reschedule',
  'appointment.cancel',
  'provider.manage',
  'service.manage',
  'user.manage',
  'settings.manage',
  'analytics.view',
  'billing.view',
  'knowledge.view',
  'knowledge.manage',
  'knowledge.publish',
  'settings.view',
  'ai_config.publish',
] as const;
export type PermissionName = (typeof PERMISSIONS)[number];
export const ROLES = [
  'SUPER_ADMIN',
  'CLINIC_ADMIN',
  'AGENT',
  'DOCTOR',
  'MANAGER',
] as const;
export const OPERATIONAL_ROLES = ['CLINIC_ADMIN', 'AGENT', 'DOCTOR'] as const;

export const ROLE_PERMISSIONS: Record<
  (typeof ROLES)[number],
  readonly PermissionName[]
> = {
  CLINIC_ADMIN: PERMISSIONS,
  AGENT: [
    'tenant.view',
    'unit.view',
    'contact.view',
    'contact.edit',
    'conversation.view',
    'conversation.reply',
    'conversation.assign',
    'conversation.transfer',
    'conversation.close',
    'patient.view',
    'patient.edit',
    'appointment.view',
    'appointment.create',
    'appointment.reschedule',
    'appointment.cancel',
    'knowledge.view',
  ],
  DOCTOR: [
    'tenant.view',
    'unit.view',
    'patient.view',
    'appointment.view',
    'knowledge.view',
  ],
  SUPER_ADMIN: [],
  MANAGER: [],
};
