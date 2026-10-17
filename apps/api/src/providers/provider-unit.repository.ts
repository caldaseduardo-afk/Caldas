import { recordAudit } from '@atendente/database';
import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../auth/database.service';
import { AuthorizationService } from '../permissions/authorization.service';
import {
  providerWhere,
  providerWrite,
  providerUnitFields,
  providerUnitPermissions,
} from './provider-access';
import type { ProviderUnitDto } from './provider.dto';
@Injectable()
export class ProviderUnitRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}
  async list(providerId: string, filter: { active?: boolean }) {
    const scope = await this.authorization.requirePermissions(
      ...providerUnitPermissions,
    );
    const row = await this.database.client.provider.findFirst({
      where: {
        id: providerId,
        ...providerWhere(scope, providerUnitPermissions),
      },
      select: {
        units: {
          where: {
            ...providerWhere(scope, providerUnitPermissions),
            active: filter.active,
          },
          select: providerUnitFields,
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!row) throw new NotFoundException('Recurso não encontrado.');
    return row.units;
  }
  create(providerId: string, dto: ProviderUnitDto & { unitId: string }) {
    return providerWrite(
      this.database,
      this.authorization,
      providerUnitPermissions,
      async (tx, scope) => {
        const where = providerWhere(scope, providerUnitPermissions);
        if (
          !(await tx.provider.findFirst({
            where: { id: providerId, ...where },
            select: { id: true },
          }))
        )
          throw new NotFoundException('Recurso não encontrado.');
        if (
          !(await tx.unit.findFirst({
            where: { id: dto.unitId, ...where },
            select: { id: true },
          }))
        )
          throw new NotFoundException('Recurso não encontrado.');
        const row = await tx.providerUnit.create({
          data: {
            tenantId: scope.tenantId,
            providerId,
            unitId: dto.unitId,
            active: dto.active,
          },
          select: providerUnitFields,
        });
        await recordAudit(tx, {
          data: {
            type: 'PROVIDER_UNIT_CREATED',
            userId: scope.userId,
            tenantId: scope.tenantId,
            resourceId: row.id,
            changes: {
              providerId,
              unitId: row.unitId,
              fields: Object.keys(dto),
              active: row.active,
            },
          },
        });
        return row;
      },
    );
  }
  update(providerId: string, id: string, dto: ProviderUnitDto) {
    return providerWrite(
      this.database,
      this.authorization,
      providerUnitPermissions,
      async (tx, scope) => {
        const [row] = await tx.providerUnit.updateManyAndReturn({
          where: {
            id,
            providerId,
            ...providerWhere(scope, providerUnitPermissions),
          },
          data: { active: dto.active },
          select: providerUnitFields,
        });
        if (!row) throw new NotFoundException('Recurso não encontrado.');
        await recordAudit(tx, {
          data: {
            type: 'PROVIDER_UNIT_UPDATED',
            userId: scope.userId,
            tenantId: scope.tenantId,
            resourceId: row.id,
            changes: {
              providerId,
              unitId: row.unitId,
              fields: Object.keys(dto),
              active: row.active,
            },
          },
        });
        return row;
      },
    );
  }
}
