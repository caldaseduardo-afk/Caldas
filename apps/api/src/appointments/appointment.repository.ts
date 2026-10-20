import { recordAudit } from '@atendente/database';
import {
  checkOperation,
  checkOperationDeadline,
} from '../permissions/operation-boundary';
import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  calendarSyncCreateData,
  recordCalendarSyncIntent,
  databaseNow,
  type PermissionName,
  type Prisma,
} from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import {
  AuthorizationService,
  authorizedTenantFilter,
  isConversationEngineScope,
} from '../permissions/authorization.service';
import type { TenantScope } from '../tenancy/tenant.context';
import {
  lockResource,
  validateSchedule,
  assertNoConflict,
} from '../scheduling/schedule';
import {
  appointmentWhere,
  appointmentFields,
  appointmentSummary,
  appointmentCalendarSummary,
  createPermissions,
  readPermissions,
  releasePermissions,
  reschedulePermissions,
  statusPermissions,
} from './appointment-access';
import type {
  appointmentDto,
  conversionDto,
  rescheduleDto,
  appointmentsQuery,
} from './appointment.dto';
import { assertTransition, type AppointmentState } from './appointment.state';
type NewAppointment = Omit<ReturnType<typeof appointmentDto>, 'source'> & {
  source: ReturnType<typeof appointmentDto>['source'] | 'WHATSAPP_AI';
};
type Conversion = Omit<ReturnType<typeof conversionDto>, 'source'> & {
  source: ReturnType<typeof conversionDto>['source'] | 'WHATSAPP_AI';
};
@Injectable()
export class AppointmentRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}
  private async write<T>(
    permissions: readonly PermissionName[],
    fn: (tx: Prisma.TransactionClient, scope: TenantScope) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const scope = await this.authorization.requirePermissions(...permissions);
      try {
        return await this.database.client.$transaction(
          async (tx) => {
            if (
              !(await tx.tenant.findFirst({
                where: authorizedTenantFilter(scope, permissions),
                select: { id: true },
              }))
            )
              throw new ForbiddenException('Permissão insuficiente.');
            await checkOperation(tx, scope);
            const result = await fn(tx, scope);
            checkOperationDeadline();
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : '';
        if (code === 'P2034' && attempt < 2) continue;
        if (['P2034', 'P2002', 'P2004'].includes(code))
          throw new ConflictException(
            'Conflito de agenda ou alteração concorrente.',
          );
        throw error;
      }
    }
  }
  private audit(
    tx: Prisma.TransactionClient,
    scope: TenantScope,
    id: string,
    type: Prisma.AuthEventCreateInput['type'],
    changes: Prisma.InputJsonObject,
  ) {
    return recordAudit(tx, {
      data: {
        tenantId: scope.tenantId,
        userId: isConversationEngineScope(scope) ? null : scope.userId,
        resourceId: id,
        type,
        changes,
      },
    });
  }
  private async insert(
    tx: Prisma.TransactionClient,
    scope: TenantScope,
    permissions: readonly PermissionName[],
    dto: NewAppointment,
    holdId?: string,
    previousAppointmentId?: string,
  ) {
    const locked = await lockResource(tx, scope, permissions, dto);
    const times = await validateSchedule(tx, scope, permissions, dto, locked);
    await assertNoConflict(
      tx,
      scope,
      permissions,
      { ...dto, ...times },
      locked.now,
      holdId,
    );
    const calendar = await calendarSyncCreateData(tx, scope.tenantId);
    const row = await tx.appointment.create({
      data: {
        tenantId: scope.tenantId,
        patientId: dto.patientId,
        contactId: dto.contactId,
        serviceId: dto.serviceId,
        providerId: dto.providerId,
        unitId: dto.unitId,
        startAt: dto.startAt,
        ...times,
        holdId,
        previousAppointmentId,
        source: dto.source,
        notes: dto.notes,
        createdByType: isConversationEngineScope(scope) ? 'AI' : 'USER',
        createdById: isConversationEngineScope(scope) ? null : scope.userId,
        status: 'PENDING_CONFIRMATION',
        ...calendar,
      },
      select: appointmentFields,
    });
    await recordCalendarSyncIntent(tx, { ...row, tenantId: scope.tenantId });
    await this.audit(tx, scope, row.id, 'APPOINTMENT_CREATED', {
      status: row.status,
      ...(holdId ? { holdId } : {}),
      ...(previousAppointmentId ? { previousAppointmentId } : {}),
    });
    return row;
  }
  create(dto: NewAppointment) {
    const permissions = dto.contactId
      ? [...createPermissions, 'contact.view' as const]
      : createPermissions;
    return this.write(permissions, (tx, scope) =>
      this.insert(tx, scope, permissions, dto),
    );
  }
  convert(dto: Conversion) {
    return this.write(createPermissions, async (tx, scope) => {
      const hold = await tx.appointmentHold.findFirst({
        where: {
          id: dto.holdId,
          ...appointmentWhere(scope, createPermissions),
        },
      });
      if (!hold) throw new NotFoundException('Recurso não encontrado.');
      const permissions = hold.contactId
        ? [...createPermissions, 'contact.view' as const]
        : createPermissions;
      if (hold.contactId)
        await this.authorization.requirePermissions(...permissions);
      const locked = await lockResource(tx, scope, permissions, hold);
      if (hold.status !== 'ACTIVE' || hold.expiresAt <= locked.now)
        throw new ConflictException('HOLD indisponível.');
      const times = await validateSchedule(
        tx,
        scope,
        permissions,
        { ...hold, endAt: undefined },
        locked,
      );
      if (
        +times.endAt !== +hold.endAt ||
        +times.occupiedStartAt !== +hold.occupiedStartAt ||
        +times.occupiedEndAt !== +hold.occupiedEndAt
      )
        throw new ConflictException('Configuração alterada; crie novo HOLD.');
      const updated = await tx.appointmentHold.updateMany({
        where: {
          id: hold.id,
          ...appointmentWhere(scope, permissions),
          status: 'ACTIVE',
          expiresAt: { gt: await databaseNow(tx) },
        },
        data: { status: 'CONSUMED' },
      });
      if (updated.count !== 1)
        throw new ConflictException('HOLD indisponível.');
      return this.insert(tx, scope, permissions, { ...hold, ...dto }, hold.id);
    });
  }
  async find(id: string) {
    const scope = await this.authorization.requirePermissions(
      ...readPermissions,
    );
    const row = await this.database.client.appointment.findFirst({
      where: { id, ...appointmentWhere(scope, readPermissions) },
      select: appointmentFields,
    });
    if (!row) throw new NotFoundException('Recurso não encontrado.');
    return row;
  }
  async list(query: ReturnType<typeof appointmentsQuery>) {
    const scope = await this.authorization.requirePermissions(
      ...readPermissions,
    );
    const { startAt, endAt, ...filter } = query;
    return this.database.client.appointment.findMany({
      where: {
        ...appointmentWhere(scope, readPermissions),
        ...filter,
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: appointmentSummary,
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    });
  }
  async calendar(query: ReturnType<typeof appointmentsQuery>) {
    const scope = await this.authorization.requirePermissions(
      ...readPermissions,
    );
    const { startAt, endAt, ...filter } = query;
    return this.database.client.appointment.findMany({
      where: {
        ...appointmentWhere(scope, readPermissions),
        ...filter,
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: appointmentCalendarSummary,
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    });
  }
  async listForAI(
    patientId: string,
    contactId: string,
    input: {
      startAt?: Date;
      endAt?: Date;
      serviceId?: string;
      limit: number;
    },
  ) {
    const scope = await this.authorization.requirePermissions(
      ...readPermissions,
    );
    const now = await databaseNow(this.database.client);
    const startAt = input.startAt && input.startAt > now ? input.startAt : now;
    const endAt = input.endAt ?? new Date(+startAt + 180 * 86400000);
    if (endAt <= startAt || +endAt - +startAt > 180 * 86400000)
      throw new ConflictException('Intervalo de consultas inválido.');
    return this.database.client.appointment.findMany({
      where: {
        ...appointmentWhere(scope, readPermissions),
        patientId,
        contactId,
        status: { in: ['PENDING_CONFIRMATION', 'CONFIRMED'] },
        startAt: { gte: startAt, lt: endAt },
        ...(input.serviceId ? { serviceId: input.serviceId } : {}),
        nextAppointment: null,
      },
      select: {
        ...appointmentSummary,
        service: { select: { name: true } },
        provider: { select: { name: true } },
        unit: { select: { name: true } },
      },
      take: input.limit,
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    });
  }
  transition(
    id: string,
    status: AppointmentState,
    reason: string | null = null,
  ) {
    const permissions =
      status === 'CANCELLED' ? releasePermissions : statusPermissions;
    return this.write(permissions, async (tx, scope) => {
      const where = { id, ...appointmentWhere(scope, permissions) };
      const row = await tx.appointment.findFirst({
        where,
        select: appointmentFields,
      });
      if (!row) throw new NotFoundException('Recurso não encontrado.');
      if (row.status === 'CANCELLED' && status === 'CANCELLED') return row;
      // Even direct repository callers must use the dedicated rescheduling transaction.
      if (status === 'RESCHEDULED')
        throw new ConflictException('Use a operação de remarcação.');
      const now = await databaseNow(tx);
      assertTransition(row.status, status, row.startAt, row.endAt, now);
      const [updated] = await tx.appointment.updateManyAndReturn({
        where: { ...where, status: row.status },
        data: {
          status,
          ...(status === 'CANCELLED'
            ? {
                cancelledAt: now,
                cancellationReason: reason,
                ...(await this.calendarMutation(
                  tx,
                  scope.tenantId,
                  row.calendarSyncRevision,
                )),
              }
            : {}),
        },
        select: appointmentFields,
      });
      if (!updated)
        throw new ConflictException('Consulta alterada simultaneamente.');
      if (status === 'CANCELLED')
        await recordCalendarSyncIntent(tx, {
          ...updated,
          tenantId: scope.tenantId,
        });
      const events = {
        CONFIRMED: 'APPOINTMENT_CONFIRMED',
        CHECKED_IN: 'APPOINTMENT_CHECKED_IN',
        COMPLETED: 'APPOINTMENT_COMPLETED',
        NO_SHOW: 'APPOINTMENT_NO_SHOW',
        CANCELLED: 'APPOINTMENT_CANCELLED',
      } as const;
      if (!(status in events))
        throw new ConflictException('Transição inválida.');
      await this.audit(tx, scope, id, events[status as keyof typeof events], {
        from: row.status,
        to: status,
      });
      return updated;
    });
  }
  reschedule(id: string, dto: ReturnType<typeof rescheduleDto>) {
    return this.write(reschedulePermissions, async (tx, scope) => {
      const where = { id, ...appointmentWhere(scope, reschedulePermissions) };
      const original = await tx.appointment.findFirst({
        where,
        select: appointmentFields,
      });
      if (!original) throw new NotFoundException('Recurso não encontrado.');
      const permissions = original.contactId
        ? [...reschedulePermissions, 'contact.view' as const]
        : reschedulePermissions;
      if (original.contactId)
        await this.authorization.requirePermissions(...permissions);
      assertTransition(
        original.status,
        'RESCHEDULED',
        original.startAt,
        original.endAt,
        await databaseNow(tx),
      );
      const [changed] = await tx.appointment.updateManyAndReturn({
        where: { ...where, status: original.status },
        data: {
          status: 'RESCHEDULED',
          ...(await this.calendarMutation(
            tx,
            scope.tenantId,
            original.calendarSyncRevision,
          )),
        },
        select: appointmentFields,
      });
      if (!changed)
        throw new ConflictException('Consulta alterada simultaneamente.');
      await recordCalendarSyncIntent(tx, {
        ...changed,
        tenantId: scope.tenantId,
      });
      const next = await this.insert(
        tx,
        scope,
        permissions,
        {
          ...dto,
          patientId: original.patientId,
          contactId: original.contactId,
        },
        undefined,
        id,
      );
      await this.audit(tx, scope, id, 'APPOINTMENT_RESCHEDULED', {
        nextAppointmentId: next.id,
        from: original.status,
        to: 'RESCHEDULED',
      });
      return next;
    });
  }

  rescheduleFromHold(
    id: string,
    holdId: string,
    source: 'WHATSAPP_AI' | 'WEB',
  ) {
    return this.write(reschedulePermissions, async (tx, scope) => {
      const where = { id, ...appointmentWhere(scope, reschedulePermissions) };
      const original = await tx.appointment.findFirst({
        where,
        select: appointmentFields,
      });
      if (!original) throw new NotFoundException('Recurso não encontrado.');
      const permissions = original.contactId
        ? [...reschedulePermissions, 'contact.view' as const]
        : reschedulePermissions;
      if (original.contactId)
        await this.authorization.requirePermissions(...permissions);
      const now = await databaseNow(tx);
      assertTransition(
        original.status,
        'RESCHEDULED',
        original.startAt,
        original.endAt,
        now,
      );
      const hold = await tx.appointmentHold.findFirst({
        where: {
          id: holdId,
          ...appointmentWhere(scope, permissions),
          patientId: original.patientId,
          contactId: original.contactId,
          serviceId: original.serviceId,
          status: 'ACTIVE',
          expiresAt: { gt: now },
        },
      });
      if (!hold) throw new ConflictException('HOLD indisponível.');
      if (
        +hold.startAt === +original.startAt &&
        +hold.endAt === +original.endAt
      )
        throw new ConflictException('A consulta já está nesse horário.');
      const locked = await lockResource(tx, scope, permissions, hold);
      const times = await validateSchedule(
        tx,
        scope,
        permissions,
        { ...hold, endAt: undefined },
        locked,
      );
      if (
        +times.endAt !== +hold.endAt ||
        +times.occupiedStartAt !== +hold.occupiedStartAt ||
        +times.occupiedEndAt !== +hold.occupiedEndAt
      )
        throw new ConflictException('Configuração alterada; crie novo HOLD.');
      const [changed] = await tx.appointment.updateManyAndReturn({
        where: { ...where, status: original.status, nextAppointment: null },
        data: {
          status: 'RESCHEDULED',
          ...(await this.calendarMutation(
            tx,
            scope.tenantId,
            original.calendarSyncRevision,
          )),
        },
        select: appointmentFields,
      });
      if (!changed)
        throw new ConflictException('Consulta alterada simultaneamente.');
      await recordCalendarSyncIntent(tx, {
        ...changed,
        tenantId: scope.tenantId,
      });
      const consumed = await tx.appointmentHold.updateMany({
        where: {
          id: hold.id,
          tenantId: scope.tenantId,
          status: 'ACTIVE',
          expiresAt: { gt: now },
        },
        data: { status: 'CONSUMED' },
      });
      if (consumed.count !== 1)
        throw new ConflictException('HOLD indisponível.');
      const next = await this.insert(
        tx,
        scope,
        permissions,
        {
          patientId: original.patientId,
          contactId: original.contactId,
          serviceId: original.serviceId,
          providerId: hold.providerId,
          unitId: hold.unitId,
          startAt: hold.startAt,
          source,
          notes: null,
        },
        hold.id,
        original.id,
      );
      await this.audit(tx, scope, original.id, 'APPOINTMENT_RESCHEDULED', {
        nextAppointmentId: next.id,
        from: original.status,
        to: 'RESCHEDULED',
        holdId: hold.id,
      });
      return next;
    });
  }

  private async calendarMutation(
    tx: Prisma.TransactionClient,
    tenantId: string,
    currentRevision: number,
  ) {
    const integration = await tx.calendarIntegration.findFirst({
      where: { tenantId, status: 'ACTIVE', provider: 'GOOGLE_CALENDAR' },
      select: { id: true },
    });
    return integration || currentRevision > 0
      ? {
          calendarProvider: 'GOOGLE_CALENDAR',
          syncStatus: 'PENDING' as const,
          calendarSyncRevision: Math.max(0, currentRevision) + 1,
          calendarSyncErrorCode: null,
        }
      : {};
  }
}
