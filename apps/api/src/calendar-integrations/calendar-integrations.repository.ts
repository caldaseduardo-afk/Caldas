import { recordAudit } from '@atendente/database';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  databaseNow,
  recordCalendarSyncIntent,
} from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import {
  AuthorizationService,
  authorizedTenantFilter,
} from '../permissions/authorization.service';
import type { CalendarIntegrationDto } from './calendar-integration.dto';

const publicFields = {
  id: true,
  provider: true,
  calendarId: true,
  status: true,
  lastTestedAt: true,
  lastErrorCode: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class CalendarIntegrationsRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}

  async get() {
    const scope = await this.authorization.requirePermissions('settings.view');
    return this.database.client.calendarIntegration.findFirst({
      where: {
        tenantId: scope.tenantId,
        tenant: authorizedTenantFilter(scope, ['settings.view']),
      },
      select: publicFields,
    });
  }

  async configure(dto: CalendarIntegrationDto) {
    const scope =
      await this.authorization.requirePermissions('settings.manage');
    return this.database.client.$transaction(
      async (tx) => {
        if (
          !(await tx.tenant.findFirst({
            where: authorizedTenantFilter(scope, ['settings.manage']),
            select: { id: true },
          }))
        )
          throw new NotFoundException('Recurso não encontrado.');
        const row = await tx.calendarIntegration.upsert({
          where: { tenantId: scope.tenantId },
          create: { tenantId: scope.tenantId, ...dto },
          update: {
            calendarId: dto.calendarId,
            credentialsReference: dto.credentialsReference,
            status: dto.status,
            lastErrorCode: null,
          },
          select: publicFields,
        });
        if (dto.status === 'ACTIVE') {
          const now = await databaseNow(tx);
          const appointments = await tx.appointment.findMany({
            where: {
              tenantId: scope.tenantId,
              startAt: { gte: now },
              status: {
                in: ['PENDING_CONFIRMATION', 'CONFIRMED', 'CHECKED_IN'],
              },
              syncStatus: { in: ['NOT_REQUIRED', 'ERROR'] },
            },
            select: {
              id: true,
              tenantId: true,
              status: true,
              calendarSyncRevision: true,
            },
          });
          for (const appointment of appointments) {
            const updated = await tx.appointment.update({
              where: {
                tenantId_id: { tenantId: scope.tenantId, id: appointment.id },
              },
              data: {
                calendarProvider: 'GOOGLE_CALENDAR',
                syncStatus: 'PENDING',
                calendarSyncRevision: appointment.calendarSyncRevision + 1,
                calendarSyncErrorCode: null,
              },
              select: {
                id: true,
                tenantId: true,
                status: true,
                calendarSyncRevision: true,
              },
            });
            await recordCalendarSyncIntent(tx, updated);
          }
        }
        await recordAudit(tx, {
          data: {
            tenantId: scope.tenantId,
            userId: scope.userId,
            resourceId: row.id,
            type: 'CALENDAR_INTEGRATION_CONFIGURED',
            changes: {
              provider: row.provider,
              status: row.status,
              calendarId: row.calendarId,
            },
          },
        });
        return row;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async internal() {
    const scope =
      await this.authorization.requirePermissions('settings.manage');
    const row = await this.database.client.calendarIntegration.findFirst({
      where: {
        tenantId: scope.tenantId,
        tenant: authorizedTenantFilter(scope, ['settings.manage']),
      },
    });
    if (!row) throw new NotFoundException('Integração não configurada.');
    return { scope, row };
  }

  async recordTest(id: string, ok: boolean, errorCode: string | null) {
    const { scope } = await this.internal();
    return this.database.client.$transaction(async (tx) => {
      const now = await databaseNow(tx);
      const row = await tx.calendarIntegration.update({
        where: { tenantId_id: { tenantId: scope.tenantId, id } },
        data: {
          lastTestedAt: now,
          lastErrorCode: errorCode,
          status: ok ? 'ACTIVE' : 'ERROR',
        },
        select: publicFields,
      });
      await recordAudit(tx, {
        data: {
          tenantId: scope.tenantId,
          userId: scope.userId,
          resourceId: id,
          type: 'CALENDAR_CONNECTION_TESTED',
          changes: {
            outcome: ok ? 'SUCCEEDED' : 'FAILED',
            ...(errorCode ? { errorCode } : {}),
          },
        },
      });
      return row;
    });
  }
}
