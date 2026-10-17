import { recordAudit } from '@atendente/database';
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import type { Prisma, PermissionName } from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import {
  AuthorizationService,
  authorizedTenantFilter,
} from '../permissions/authorization.service';
import type { TenantScope } from '../tenancy/tenant.context';
import { timeText } from '../availability/availability.dto';
import {
  validateNotificationRule,
  type notificationFilter,
  type previewDto,
  type resolutionDto,
} from './notification.dto';
import type { NotificationRuleData } from './notification.schedule';
export const managePermissions: [PermissionName, ...PermissionName[]] = [
  'settings.manage',
];
export const resolvePermissions: [PermissionName, ...PermissionName[]] = [
  'settings.manage',
  'appointment.view',
  'patient.view',
];
const ruleFields = {
  id: true,
  type: true,
  offsetMinutes: true,
  allowedStartTime: true,
  allowedEndTime: true,
  allowedWeekdays: true,
  outsideWindowPolicy: true,
  retryEnabled: true,
  retryAfterMinutes: true,
  maxAttempts: true,
  minimumTimeBeforeAppointment: true,
  actionIfNoResponse: true,
  active: true,
} as const;
const whereFor = (
  scope: TenantScope,
  permissions: readonly PermissionName[],
) => ({
  tenantId: scope.tenantId,
  tenant: authorizedTenantFilter(scope, permissions),
});
export function notificationResponse<T extends NotificationRuleData>(rule: T) {
  return {
    ...rule,
    allowedStartTime: timeText(rule.allowedStartTime),
    allowedEndTime: timeText(rule.allowedEndTime),
  };
}
@Injectable()
export class NotificationRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}
  private async write<T>(
    fn: (tx: Prisma.TransactionClient, scope: TenantScope) => Promise<T>,
  ) {
    const scope = await this.authorization.requirePermissions(
      ...managePermissions,
    );
    try {
      return await this.database.client.$transaction(
        async (tx) => {
          if (
            !(await tx.tenant.findFirst({
              where: authorizedTenantFilter(scope, managePermissions),
              select: { id: true },
            }))
          )
            throw new ForbiddenException('Permissão insuficiente.');
          return fn(tx, scope);
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : '';
      if (['P2034', 'P2004'].includes(code))
        throw new ConflictException(
          'Alteração concorrente ou configuração inválida.',
        );
      throw error;
    }
  }
  create(dto: NotificationRuleData) {
    return this.write(async (tx, scope) => {
      validateNotificationRule(dto);
      const row = await tx.notificationRule.create({
        data: { ...dto, tenantId: scope.tenantId },
        select: ruleFields,
      });
      await recordAudit(tx, {
        data: {
          tenantId: scope.tenantId,
          userId: scope.userId,
          resourceId: row.id,
          type: 'NOTIFICATION_RULE_CREATED',
          changes: {
            type: row.type,
            active: row.active,
            fields: Object.keys(dto),
          },
        },
      });
      return notificationResponse(row);
    });
  }
  update(id: string, dto: Partial<NotificationRuleData>) {
    return this.write(async (tx, scope) => {
      const where = { id, ...whereFor(scope, managePermissions) };
      const old = await tx.notificationRule.findFirst({
        where,
        select: ruleFields,
      });
      if (!old) throw new NotFoundException('Recurso não encontrado.');
      validateNotificationRule({ ...old, ...dto });
      const [row] = await tx.notificationRule.updateManyAndReturn({
        where,
        data: dto,
        select: ruleFields,
      });
      if (!row) throw new NotFoundException('Recurso não encontrado.');
      await recordAudit(tx, {
        data: {
          tenantId: scope.tenantId,
          userId: scope.userId,
          resourceId: id,
          type: 'NOTIFICATION_RULE_UPDATED',
          changes: {
            fields: Object.keys(dto),
            active: row.active,
            type: row.type,
          },
        },
      });
      return notificationResponse(row);
    });
  }
  async find(id: string) {
    const scope = await this.authorization.requirePermissions(
      ...managePermissions,
    );
    const row = await this.database.client.notificationRule.findFirst({
      where: { id, ...whereFor(scope, managePermissions) },
      select: ruleFields,
    });
    if (!row) throw new NotFoundException('Recurso não encontrado.');
    return notificationResponse(row);
  }
  async list(filter: ReturnType<typeof notificationFilter>) {
    const scope = await this.authorization.requirePermissions(
      ...managePermissions,
    );
    const rows = await this.database.client.notificationRule.findMany({
      where: { ...whereFor(scope, managePermissions), ...filter },
      select: ruleFields,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(notificationResponse);
  }
  async calculation(
    id: string,
    input: ReturnType<typeof previewDto> | ReturnType<typeof resolutionDto>,
  ) {
    const isAppointment = 'appointmentId' in input;
    const permissions = isAppointment ? resolvePermissions : managePermissions;
    const scope = await this.authorization.requirePermissions(...permissions);
    return this.database.client.$transaction(
      async (tx) => {
        const where = whereFor(scope, permissions);
        const rule = await tx.notificationRule.findFirst({
          where: { ...where, id },
          select: ruleFields,
        });
        if (!rule) throw new NotFoundException('Recurso não encontrado.');
        if (isAppointment) {
          const row = await tx.appointment.findFirst({
            where: { ...where, id: input.appointmentId },
            select: {
              startAt: true,
              status: true,
              unit: { select: { timezoneOverride: true } },
              tenant: { select: { timezone: true } },
            },
          });
          if (!row) throw new NotFoundException('Recurso não encontrado.');
          return {
            rule,
            appointmentStart: row.startAt,
            timezone: row.unit.timezoneOverride ?? row.tenant.timezone,
            appointmentActive: ['PENDING_CONFIRMATION', 'CONFIRMED'].includes(
              row.status,
            ),
          };
        }
        if (input.unitId) {
          const unit = await tx.unit.findFirst({
            where: { ...where, id: input.unitId },
            select: {
              timezoneOverride: true,
              tenant: { select: { timezone: true } },
            },
          });
          if (!unit) throw new NotFoundException('Recurso não encontrado.');
          return {
            rule,
            appointmentStart: input.appointmentStart,
            timezone: unit.timezoneOverride ?? unit.tenant.timezone,
            appointmentActive: true,
          };
        }
        const tenant = await tx.tenant.findFirst({
          where: authorizedTenantFilter(scope, permissions),
          select: { timezone: true },
        });
        if (!tenant) throw new NotFoundException('Recurso não encontrado.');
        return {
          rule,
          appointmentStart: input.appointmentStart,
          timezone: tenant.timezone,
          appointmentActive: true,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
