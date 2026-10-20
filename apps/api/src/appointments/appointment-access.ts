import type { PermissionName } from '@atendente/database';
export {
  createPermissions,
  readPermissions,
  releasePermissions,
  holdWhere as appointmentWhere,
} from '../holds/hold-access';
export const reschedulePermissions: [PermissionName, ...PermissionName[]] = [
  'appointment.reschedule',
  'patient.view',
  'unit.view',
];
export const statusPermissions: [PermissionName, ...PermissionName[]] = [
  'appointment.create',
  'patient.view',
];
export const appointmentSummary = {
  id: true,
  patientId: true,
  contactId: true,
  serviceId: true,
  providerId: true,
  unitId: true,
  startAt: true,
  endAt: true,
  status: true,
  source: true,
  previousAppointmentId: true,
} as const;
export const appointmentFields = {
  ...appointmentSummary,
  holdId: true,
  createdByType: true,
  createdById: true,
  notes: true,
  cancelledAt: true,
  cancellationReason: true,
  calendarProvider: true,
  externalEventId: true,
  syncStatus: true,
  calendarSyncRevision: true,
  calendarSyncAttemptsCount: true,
  calendarSyncErrorCode: true,
  calendarLastSyncedAt: true,
} as const;


export const appointmentCalendarSummary = {
  id: true,
  startAt: true,
  endAt: true,
  status: true,
  patient: { select: { name: true } },
  service: { select: { name: true } },
  provider: { select: { name: true } },
  unit: { select: { name: true } },
} as const;
