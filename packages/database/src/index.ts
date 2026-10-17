import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

// Infraestrutura de backend. Não importar no frontend ou nas tools da IA.
export function createDatabaseClient(connectionString: string) {
  if (!connectionString.trim()) {
    throw new Error('DATABASE_URL deve ser configurada.');
  }
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    // TypeError de URL inclui o input original; não propagar credenciais.
    throw new Error('DATABASE_URL inválida.');
  }
  if (!['postgresql:', 'postgres:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL deve apontar para PostgreSQL.');
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: [],
  });
}

export { Prisma } from './generated/prisma/client';

export {
  PERMISSIONS,
  ROLES,
  OPERATIONAL_ROLES,
  type PermissionName,
} from './rbac-catalog';

export {
  databaseNow,
  expireTenantHolds,
  sweepExpiredHolds,
} from './hold-expiration';
export {
  startHumanSlaCycle,
  closeHumanSlaCycle,
  processHumanSlaJob,
  parseHumanSlaPayload,
  type HumanSlaNotice,
  type HumanSlaPayload,
} from './human-sla';
export {
  HUMAN_SLA_QUEUE,
  humanSlaConnection,
  createHumanSlaQueue,
  dispatchHumanSlaJobs,
  createHumanSlaWorker,
  subscribeHumanSlaUpdates,
} from './human-sla-queue';
export { WhatsAppProvider, whatsappAccessToken } from './whatsapp-provider';
export * from './messaging-delivery';
export * from './messaging-queue';
export * from './conversation-engine-queue';
export * from './notification-automation';
export * from './notification-queue';
export * from './google-calendar-provider';
export * from './calendar-sync';
export * from './calendar-sync-queue';
export {
  CalendarProviderError,
  type CalendarProvider,
  type CalendarProviderContext,
  type CalendarEventInput,
} from '@atendente/domain';
export {
  resolveNotificationSchedule,
  resolveRetrySchedule,
  resolveNotificationExecution,
} from '@atendente/domain';

export * from './audit';
export { AuditActorType, AuditSource, AuditResourceType, AuthEventType } from './generated/prisma/client';
