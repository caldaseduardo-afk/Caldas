import { recordAudit } from '@atendente/database';
import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../auth/database.service';
import { AuthorizationService } from '../permissions/authorization.service';
import {
  availabilityPermissions,
  availabilityWhere,
  availabilityWrite,
  checkFilters,
  lockPair,
  exceptionFields,
  presentException,
} from './availability-access';
import {
  validateException,
  type ExceptionData,
  type Pair,
  type AvailabilityFilter,
} from './availability.dto';
const data = (dto: ExceptionData) => ({
  date: dto.date,
  startTime: dto.startTime,
  endTime: dto.endTime,
  type: dto.type,
  reason: dto.reason,
  active: dto.active,
});
@Injectable()
export class ScheduleExceptionRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}
  async list(filter: AvailabilityFilter) {
    const scope = await this.authorization.requirePermissions(
      ...availabilityPermissions,
    );
    await checkFilters(this.database, scope, filter);
    return (
      await this.database.client.scheduleException.findMany({
        where: {
          ...availabilityWhere(scope),
          providerId: filter.providerId,
          unitId: filter.unitId,
          active: filter.active,
          date: { gte: filter.dateFrom, lte: filter.dateUntil },
        },
        select: exceptionFields,
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
      })
    ).map(presentException);
  }
  async find(id: string) {
    const scope = await this.authorization.requirePermissions(
      ...availabilityPermissions,
    );
    const row = await this.database.client.scheduleException.findFirst({
      where: { id, ...availabilityWhere(scope) },
      select: exceptionFields,
    });
    if (!row) throw new NotFoundException('Recurso não encontrado.');
    return presentException(row);
  }
  create(dto: ExceptionData & Pair) {
    return availabilityWrite(
      this.database,
      this.authorization,
      async (tx, scope) => {
        validateException(dto);
        await lockPair(tx, scope, dto, dto.active);
        const row = await tx.scheduleException.create({
          data: {
            tenantId: scope.tenantId,
            providerId: dto.providerId,
            unitId: dto.unitId,
            ...data(dto),
          },
          select: exceptionFields,
        });
        await recordAudit(tx, {
          data: {
            type: 'SCHEDULE_EXCEPTION_CREATED',
            userId: scope.userId,
            tenantId: scope.tenantId,
            resourceId: row.id,
            changes: {
              fields: Object.keys(dto),
              providerId: row.providerId,
              unitId: row.unitId,
              active: row.active,
            },
          },
        });
        return presentException(row);
      },
    );
  }
  update(id: string, dto: Partial<ExceptionData>) {
    return availabilityWrite(
      this.database,
      this.authorization,
      async (tx, scope) => {
        const where = { id, ...availabilityWhere(scope) };
        const before = await tx.scheduleException.findFirst({
          where,
          select: exceptionFields,
        });
        if (!before) throw new NotFoundException('Recurso não encontrado.');
        const merged = { ...before, ...dto };
        validateException(merged);
        await lockPair(tx, scope, before, merged.active);
        const [row] = await tx.scheduleException.updateManyAndReturn({
          where,
          data: data(merged),
          select: exceptionFields,
        });
        if (!row) throw new NotFoundException('Recurso não encontrado.');
        await recordAudit(tx, {
          data: {
            type: 'SCHEDULE_EXCEPTION_UPDATED',
            userId: scope.userId,
            tenantId: scope.tenantId,
            resourceId: id,
            changes: {
              fields: Object.keys(dto),
              providerId: row.providerId,
              unitId: row.unitId,
              active: row.active,
            },
          },
        });
        return presentException(row);
      },
    );
  }
}
