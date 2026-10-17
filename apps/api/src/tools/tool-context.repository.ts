import { Injectable } from '@nestjs/common';
import type { Prisma } from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import { authorizedTenantFilter } from '../permissions/authorization.service';
import type { TenantScope } from '../tenancy/tenant.context';
import { ToolExecutionError } from './tool.errors';
import { sanitizeAIText } from '../ai/ai-context';
export interface TrustedToolContext {
  scope: TenantScope;
  conversationId: string;
  contactId: string;
  activePatientId: string | null;
  actorType: 'AI' | 'USER';
  correlationId: string;
}
export const toolViewPermissions = [
  'conversation.view',
  'contact.view',
] as const;
@Injectable()
export class ToolContextRepository {
  constructor(private readonly database: DatabaseService) {}
  async load(
    scope: TenantScope,
    conversationId: string,
    db: Prisma.TransactionClient = this.database.client,
  ) {
    const row = await db.conversation.findFirst({
      where: {
        id: conversationId,
        tenantId: scope.tenantId,
        tenant: authorizedTenantFilter(scope, toolViewPermissions),
        contact: { tenantId: scope.tenantId, status: 'ACTIVE' },
      },
      select: {
        id: true,
        contactId: true,
        activePatientId: true,
        status: true,
        assignedUserId: true,
        channel: true,
      },
    });
    if (!row) throw new ToolExecutionError('RESOURCE_NOT_FOUND');
    return row;
  }
  async validate(
    context: TrustedToolContext,
    needsPatient: boolean,
    db: Prisma.TransactionClient = this.database.client,
    lock = false,
    handoffReplay = false,
  ) {
    const { scope } = context;
    if (lock) {
      // Same row lock as handoff; relationship writers serialize on Patient.
      await db.conversation.updateMany({
        where: {
          id: context.conversationId,
          tenantId: scope.tenantId,
          tenant: authorizedTenantFilter(scope, toolViewPermissions),
        },
        data: { updatedAt: new Date() },
      });
      if (context.activePatientId)
        await db.patient.updateMany({
          where: { id: context.activePatientId, tenantId: scope.tenantId },
          data: { updatedAt: new Date() },
        });
    }
    const row = await this.load(scope, context.conversationId, db);
    if (
      row.contactId !== context.contactId ||
      row.activePatientId !== context.activePatientId
    )
      throw new ToolExecutionError('FORBIDDEN');
    const allowed =
      context.actorType === 'AI'
        ? row.status === 'AI_ACTIVE'
        : row.status === 'AI_ACTIVE' ||
          (row.status === 'HUMAN_ACTIVE' &&
            row.assignedUserId === scope.userId);
    if (!allowed && !(handoffReplay && row.status === 'NEEDS_HUMAN'))
      throw new ToolExecutionError('FORBIDDEN');
    if (needsPatient) {
      if (
        !context.activePatientId ||
        !(await db.contactPatient.findFirst({
          where: {
            tenantId: scope.tenantId,
            contactId: context.contactId,
            patientId: context.activePatientId,
            active: true,
            relationshipStatus: 'VERIFIED',
            authorizationLevel: { in: ['FULL', 'SCHEDULING_ONLY'] },
            tenant: authorizedTenantFilter(scope, [
              ...toolViewPermissions,
              'patient.view',
            ]),
          },
          select: { id: true },
        }))
      )
        throw new ToolExecutionError('INVALID_RELATIONSHIP');
    }
    return row;
  }
  async minimal(context: TrustedToolContext) {
    await this.validate(context, false);
    const where = {
      tenantId: context.scope.tenantId,
      tenant: authorizedTenantFilter(context.scope, [
        ...toolViewPermissions,
        'patient.view',
      ]),
    };
    const contact = await this.database.client.contact.findFirst({
      where: { ...where, id: context.contactId, status: 'ACTIVE' },
      select: { displayName: true },
    });
    if (!contact) throw new ToolExecutionError('RESOURCE_NOT_FOUND');
    const links = await this.database.client.contactPatient.findMany({
      where: {
        ...where,
        contactId: context.contactId,
        active: true,
        relationshipStatus: 'VERIFIED',
        authorizationLevel: { in: ['FULL', 'SCHEDULING_ONLY'] },
      },
      select: {
        patientId: true,
        patient: { select: { name: true } },
        relationshipType: true,
        authorizationLevel: true,
      },
      take: 100,
      orderBy: { patientId: 'asc' },
    });
    const conversation = await this.load(context.scope, context.conversationId);
    return {
      contactId: context.contactId,
      name: sanitizeAIText(contact.displayName).slice(0, 200),
      channel: conversation.channel,
      activePatientId: links.some(
        (link) => link.patientId === context.activePatientId,
      )
        ? context.activePatientId
        : null,
      patients: links.map((l) => ({
        patientId: l.patientId,
        name: sanitizeAIText(l.patient.name).slice(0, 200),
        relationship: l.relationshipType,
        status: 'VERIFIED',
        authorizationLevel: l.authorizationLevel,
      })),
    };
  }
  async target(
    context: TrustedToolContext,
    kind: 'appointment' | 'appointmentHold',
    id: string,
    db: Prisma.TransactionClient = this.database.client,
    allowInactiveHold = false,
  ) {
    const where = {
      id,
      tenantId: context.scope.tenantId,
      patientId: context.activePatientId ?? '',
      contactId: context.contactId,
      tenant: authorizedTenantFilter(context.scope, [
        'appointment.view',
        'patient.view',
      ]),
    };
    if (kind === 'appointment') {
      if (!(await db.appointment.findFirst({ where, select: { id: true } })))
        throw new ToolExecutionError('RESOURCE_NOT_FOUND');
    } else {
      const row = await db.appointmentHold.findFirst({
        where,
        select: { id: true, status: true, expiresAt: true },
      });
      if (!row) throw new ToolExecutionError('RESOURCE_NOT_FOUND');
      if (
        !allowInactiveHold &&
        (row.status !== 'ACTIVE' || row.expiresAt <= new Date())
      )
        throw new ToolExecutionError('HOLD_EXPIRED');
    }
  }
}
