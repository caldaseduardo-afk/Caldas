import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Prisma } from './generated/prisma/client';
import type {
  AuditActorType,
  AuditSource,
  AuditResourceType,
  AuthEventType,
} from './generated/prisma/client';

export interface AuditActorContext {
  tenantId: string;
  actorType: AuditActorType;
  actorUserId?: string | null;
  actorReferenceId?: string;
  source: AuditSource;
  correlationId?: string;
}
/** Trusted server execution only. Never populate from DTO/model arguments. */
export const auditActorContext = new AsyncLocalStorage<AuditActorContext>();
export const AUDIT_ACTION_RESOURCES: Partial<
  Record<AuthEventType, AuditResourceType>
> = {
  TENANT_CREATED: 'TENANT',
  TENANT_UPDATED: 'TENANT',
  TENANT_DEACTIVATED: 'TENANT',
  TENANT_MEMBERSHIP_GRANTED: 'USER',
  UNIT_CREATED: 'UNIT',
  UNIT_UPDATED: 'UNIT',
  UNIT_DEACTIVATED: 'UNIT',
  AI_CONFIG_VERSION_CREATED: 'AI_CONFIGURATION',
  AI_CONFIG_VERSION_UPDATED: 'AI_CONFIGURATION',
  AI_CONFIG_PUBLISHED: 'AI_CONFIGURATION',
  AI_CONFIG_RESTORED: 'AI_CONFIGURATION',
  KNOWLEDGE_ARTICLE_CREATED: 'KNOWLEDGE_ARTICLE',
  KNOWLEDGE_ARTICLE_UPDATED: 'KNOWLEDGE_ARTICLE',
  KNOWLEDGE_ARTICLE_PUBLISHED: 'KNOWLEDGE_ARTICLE',
  KNOWLEDGE_ARTICLE_INACTIVATED: 'KNOWLEDGE_ARTICLE',
  NOTIFICATION_RULE_CREATED: 'NOTIFICATION_RULE',
  NOTIFICATION_RULE_UPDATED: 'NOTIFICATION_RULE',
  APPOINTMENT_CREATED: 'APPOINTMENT',
  APPOINTMENT_CONFIRMED: 'APPOINTMENT',
  APPOINTMENT_CANCELLED: 'APPOINTMENT',
  APPOINTMENT_RESCHEDULED: 'APPOINTMENT',
  APPOINTMENT_CHECKED_IN: 'APPOINTMENT',
  APPOINTMENT_COMPLETED: 'APPOINTMENT',
  APPOINTMENT_NO_SHOW: 'APPOINTMENT',
  HOLD_CREATED: 'APPOINTMENT_HOLD',
  HOLD_RELEASED: 'APPOINTMENT_HOLD',
  HOLD_EXPIRED: 'APPOINTMENT_HOLD',
  AVAILABILITY_RULE_CREATED: 'AVAILABILITY_RULE',
  AVAILABILITY_RULE_UPDATED: 'AVAILABILITY_RULE',
  SCHEDULE_EXCEPTION_CREATED: 'SCHEDULE_EXCEPTION',
  SCHEDULE_EXCEPTION_UPDATED: 'SCHEDULE_EXCEPTION',
  PROVIDER_CREATED: 'PROVIDER',
  PROVIDER_UPDATED: 'PROVIDER',
  PROVIDER_SERVICE_CREATED: 'PROVIDER',
  PROVIDER_SERVICE_UPDATED: 'PROVIDER',
  PROVIDER_UNIT_CREATED: 'PROVIDER',
  PROVIDER_UNIT_UPDATED: 'PROVIDER',
  SPECIALTY_CREATED: 'SPECIALTY',
  SPECIALTY_UPDATED: 'SPECIALTY',
  SERVICE_CREATED: 'SERVICE',
  SERVICE_UPDATED: 'SERVICE',
  CONTACT_CREATED: 'CONTACT',
  CONTACT_UPDATED: 'CONTACT',
  CONTACT_CHANNEL_CREATED: 'CONTACT_CHANNEL',
  CONTACT_CHANNEL_UPDATED: 'CONTACT_CHANNEL',
  PATIENT_CREATED: 'PATIENT',
  PATIENT_UPDATED: 'PATIENT',
  CONTACT_PATIENT_CREATED: 'CONTACT_PATIENT',
  CONTACT_PATIENT_UPDATED: 'CONTACT_PATIENT',
  CONTACT_PATIENT_REVOKED: 'CONTACT_PATIENT',
  HUMAN_HANDOFF_REQUESTED: 'CONVERSATION',
  CONVERSATION_CLAIMED: 'CONVERSATION',
  CONVERSATION_TRANSFERRED: 'CONVERSATION',
  CONVERSATION_RETURNED_TO_AI: 'CONVERSATION',
  CONVERSATION_RESOLVED: 'CONVERSATION',
  CONVERSATION_CREATED: 'CONVERSATION',
  CONVERSATION_UPDATED: 'CONVERSATION',
  CONVERSATION_STATUS_CHANGED: 'CONVERSATION',
  CONVERSATION_ENGINE_HANDOFF: 'CONVERSATION',
  HUMAN_SLA_RULE_CREATED: 'HUMAN_SLA_RULE',
  HUMAN_SLA_RULE_UPDATED: 'HUMAN_SLA_RULE',
  INTEGRATION_CONFIGURED: 'INTEGRATION',
  CALENDAR_INTEGRATION_CONFIGURED: 'INTEGRATION',
};
const sensitive =
  /password|passwd|token|apikey|secret|authorization|cookie|session|email|phone|cpf|document|prompt|content|arguments|headers|notes/i;
/** Central recursive minimization with bounded depth/size. JSON is always rendered as text. */
export function sanitizeAudit(
  value: unknown,
  depth = 0,
): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  if (depth > 8) return '[TRUNCATED]';
  if (typeof value === 'string')
    return value
      .slice(0, 1000)
      .replace(/Bearer\s+\S+/gi, '[REDACTED]')
      .replace(/\bsk-[\w-]+/g, '[REDACTED]');
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value))
    return value.slice(0, 50).map((v) => sanitizeAudit(v, depth + 1));
  if (typeof value !== 'object') return null;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 100)
      .filter(
        ([key]) =>
          (key === 'authorizationLevel' ||
            !sensitive.test(key.replace(/[_-]/g, ''))) &&
          !['__proto__', 'constructor', 'prototype'].includes(key),
      )
      .map(([key, v]) => [key, sanitizeAudit(v, depth + 1)]),
  );
}
type Writer = Pick<Prisma.TransactionClient, 'authEvent'>;
type Data = Prisma.AuthEventUncheckedCreateInput;
/** Explicit call at the domain mutation, using the caller's transaction. */
export function recordAudit(
  tx: Writer,
  args: { data: Data },
  actor?: AuditActorContext,
) {
  const data = args.data;
  const context = actor ?? auditActorContext.getStore();
  if (context && context.tenantId !== data.tenantId)
    throw new Error('AUDIT_TENANT_MISMATCH');
  const resourceType = AUDIT_ACTION_RESOURCES[data.type];
  if (resourceType && (!data.tenantId || !data.resourceId))
    throw new Error('AUDIT_RESOURCE_REQUIRED');
  const actorType = context?.actorType ?? (data.userId ? 'USER' : 'SYSTEM');
  const userId =
    actorType === 'USER' ? (context?.actorUserId ?? data.userId) : null;
  if (actorType === 'USER' && !userId) throw new Error('AUDIT_ACTOR_REQUIRED');
  const safe = sanitizeAudit(data.changes);
  const changes =
    safe && typeof safe === 'object' && !Array.isArray(safe)
      ? (safe as Prisma.InputJsonObject)
      : {};
  const before =
    changes.before ??
    (changes.from
      ? {
          status: changes.from,
          ...('previousAssignee' in changes
            ? { assignedUserId: changes.previousAssignee }
            : {}),
        }
      : undefined);
  const after =
    changes.after ??
    (changes.to
      ? {
          status: changes.to,
          ...('newAssignee' in changes
            ? { assignedUserId: changes.newAssignee }
            : {}),
        }
      : changes.status
        ? { status: changes.status }
        : undefined);
  return tx.authEvent.create({
    data: {
      ...data,
      userId,
      actorType,
      actorReferenceId: context?.actorReferenceId,
      source: context?.source ?? (userId ? 'WEB' : 'SYSTEM'),
      correlationId:
        context?.correlationId ?? data.correlationId ?? randomUUID(),
      isBusiness: !!resourceType,
      resourceType: resourceType ?? null,
      changes: safe ?? Prisma.JsonNull,
      previousValues:
        sanitizeAudit(data.previousValues ?? before) ?? Prisma.JsonNull,
      newValues: sanitizeAudit(data.newValues ?? after) ?? Prisma.JsonNull,
      metadata: sanitizeAudit(data.metadata ?? changes) ?? Prisma.JsonNull,
    },
  });
}
export async function recordAuditMany(
  tx: Writer,
  args: { data: Data[] },
  actor?: AuditActorContext,
) {
  for (const data of args.data) await recordAudit(tx, { data }, actor);
  return { count: args.data.length };
}

export function recordAutomationAudit(tx: Writer, args: { data: Data }) {
  return recordAudit(tx, args, {
    tenantId: args.data.tenantId!,
    actorType: 'AUTOMATION',
    source: 'WORKER',
  });
}
export async function recordAutomationAuditMany(
  tx: Writer,
  args: { data: Data[] },
) {
  for (const data of args.data) await recordAutomationAudit(tx, { data });
  return { count: args.data.length };
}
export function recordAiAudit(tx: Writer, args: { data: Data }) {
  const changes = args.data.changes as Record<string, unknown> | undefined;
  return recordAudit(
    tx,
    args,
    auditActorContext.getStore() ?? {
      tenantId: args.data.tenantId!,
      actorType: 'AI',
      source: 'AI_ENGINE',
      correlationId:
        typeof changes?.runId === 'string'
          ? changes.runId
          : (args.data.correlationId ?? undefined),
    },
  );
}
export async function recordAiAuditMany(tx: Writer, args: { data: Data[] }) {
  for (const data of args.data) await recordAiAudit(tx, { data });
  return { count: args.data.length };
}
export function recordIntegrationAudit(tx: Writer, args: { data: Data }) {
  return recordAudit(tx, args, {
    tenantId: args.data.tenantId!,
    actorType: 'INTEGRATION',
    source: 'WHATSAPP',
  });
}
