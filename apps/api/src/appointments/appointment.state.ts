import { ConflictException } from '@nestjs/common';
export const states = [
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'CHECKED_IN',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
] as const;
export type AppointmentState = (typeof states)[number];
const transitions: Record<AppointmentState, readonly AppointmentState[]> = {
  PENDING_CONFIRMATION: ['CONFIRMED', 'CANCELLED', 'RESCHEDULED'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'RESCHEDULED', 'NO_SHOW'],
  CHECKED_IN: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
  RESCHEDULED: [],
};
export function assertTransition(
  from: AppointmentState,
  to: AppointmentState,
  start: Date,
  end: Date,
  now: Date,
) {
  if (!transitions[from].includes(to))
    throw new ConflictException('Transição de estado inválida.');
  if ((to === 'CHECKED_IN' || to === 'NO_SHOW') && start > now)
    throw new ConflictException('Atendimento ainda não iniciou.');
  if (to === 'COMPLETED' && end > now)
    throw new ConflictException('Atendimento ainda não terminou.');
}
