import { recordAudit } from '@atendente/database';
import { configurationWrite } from '../configuration/configuration-write';
import type { CreateUnitDto, UpdateUnitDto } from './unit.dto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../auth/database.service';
import {
  AuthorizationService,
  authorizedTenantFilter,
} from '../permissions/authorization.service';

const fields = { id: true, tenantId: true, name: true } as const;

@Injectable()
export class UnitRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}
  async list() {
    const scope = await this.authorization.requirePermissions('unit.view');
    return this.database.client.unit.findMany({
      where: {
        tenantId: scope.tenantId,
        tenant: authorizedTenantFilter(scope, ['unit.view']),
      },
      select: fields,
      orderBy: { id: 'asc' },
    });
  }
  async findById(id: string) {
    const scope = await this.authorization.requirePermissions('unit.view');
    const unit = await this.database.client.unit.findFirst({
      where: {
        id,
        tenantId: scope.tenantId,
        tenant: authorizedTenantFilter(scope, ['unit.view']),
      },
      select: fields,
    });
    if (!unit) throw new NotFoundException('Recurso não encontrado.');
    return unit;
  }

  async listFull() {
    const scope = await this.authorization.requirePermissions('unit.view');
    const rows = await this.database.client.unit.findMany({
      where: {
        tenantId: scope.tenantId,
        tenant: authorizedTenantFilter(scope, ['unit.view']),
      },
      include: { tenant: { select: { timezone: true } } },
      orderBy: { id: 'asc' },
    });
    return rows.map(({ tenant, ...unit }) => ({
      ...unit,
      effectiveTimezone: unit.timezoneOverride ?? tenant.timezone,
    }));
  }
  async findFull(id: string) {
    const scope = await this.authorization.requirePermissions('unit.view');
    const row = await this.database.client.unit.findFirst({
      where: {
        id,
        tenantId: scope.tenantId,
        tenant: authorizedTenantFilter(scope, ['unit.view']),
      },
      include: { tenant: { select: { timezone: true } } },
    });
    if (!row) throw new NotFoundException('Recurso não encontrado.');
    const { tenant, ...unit } = row;
    return {
      ...unit,
      effectiveTimezone: unit.timezoneOverride ?? tenant.timezone,
    };
  }
  create(dto: CreateUnitDto) {
    return configurationWrite(
      this.database,
      this.authorization,
      async (tx, scope) => {
        const unit = await tx.unit.create({
          data: {
            name: dto.name,
            address: dto.address,
            active: dto.active,
            timezoneOverride: dto.timezoneOverride,
            tenantId: scope.tenantId,
          },
        });
        await recordAudit(tx, {
          data: {
            type: 'UNIT_CREATED',
            userId: scope.userId,
            tenantId: scope.tenantId,
            resourceId: unit.id,
            changes: {
              after: {
                name: unit.name,
                address: unit.address,
                active: unit.active,
                timezoneOverride: unit.timezoneOverride,
              },
            },
          },
        });
        return unit;
      },
    );
  }
  update(id: string, dto: UpdateUnitDto) {
    return configurationWrite(
      this.database,
      this.authorization,
      async (tx, scope) => {
        const where = {
          id,
          tenantId: scope.tenantId,
          tenant: authorizedTenantFilter(scope, ['settings.manage']),
        };
        const before = await tx.unit.findFirst({ where });
        if (!before) throw new NotFoundException('Recurso não encontrado.');
        const [unit] = await tx.unit.updateManyAndReturn({
          where,
          data: {
            name: dto.name,
            address: dto.address,
            active: dto.active,
            timezoneOverride: dto.timezoneOverride,
          },
        });
        if (!unit) throw new NotFoundException('Recurso não encontrado.');
        await recordAudit(tx, {
          data: {
            type:
              before.active && !unit.active
                ? 'UNIT_DEACTIVATED'
                : 'UNIT_UPDATED',
            userId: scope.userId,
            tenantId: scope.tenantId,
            resourceId: unit.id,
            changes: {
              before: {
                name: before.name,
                address: before.address,
                active: before.active,
                timezoneOverride: before.timezoneOverride,
              },
              after: {
                name: unit.name,
                address: unit.address,
                active: unit.active,
                timezoneOverride: unit.timezoneOverride,
              },
            },
          },
        });
        return unit;
      },
    );
  }
}
