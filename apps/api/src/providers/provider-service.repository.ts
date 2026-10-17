import { recordAudit } from '@atendente/database';
import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../auth/database.service';
import { AuthorizationService } from '../permissions/authorization.service';
import {
  providerWhere,
  providerWrite,
  providerServiceFields,
  providerServicePermissions,
  presentProviderService,
} from './provider-access';
import type { ProviderServiceDto } from './provider.dto';
@Injectable()
export class ProviderServiceRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}
  async list(providerId: string, filter: { active?: boolean }) {
    const scope = await this.authorization.requirePermissions(
      ...providerServicePermissions,
    );
    const row = await this.database.client.provider.findFirst({
      where: {
        id: providerId,
        ...providerWhere(scope, providerServicePermissions),
      },
      select: {
        services: {
          where: {
            ...providerWhere(scope, providerServicePermissions),
            active: filter.active,
          },
          select: providerServiceFields,
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!row) throw new NotFoundException('Recurso não encontrado.');
    return row.services.map(presentProviderService);
  }
  create(providerId: string, dto: ProviderServiceDto & { serviceId: string }) {
    return providerWrite(
      this.database,
      this.authorization,
      providerServicePermissions,
      async (tx, scope) => {
        const where = providerWhere(scope, providerServicePermissions);
        if (
          !(await tx.provider.findFirst({
            where: { id: providerId, ...where },
            select: { id: true },
          }))
        )
          throw new NotFoundException('Recurso não encontrado.');
        if (
          !(await tx.service.findFirst({
            where: { id: dto.serviceId, ...where },
            select: { id: true },
          }))
        )
          throw new NotFoundException('Recurso não encontrado.');
        const row = await tx.providerService.create({
          data: {
            tenantId: scope.tenantId,
            providerId,
            serviceId: dto.serviceId,
            active: dto.active,
            durationOverrideMinutes: dto.durationOverrideMinutes,
            priceOverride: dto.priceOverride,
          },
          select: providerServiceFields,
        });
        await recordAudit(tx, {
          data: {
            type: 'PROVIDER_SERVICE_CREATED',
            userId: scope.userId,
            tenantId: scope.tenantId,
            resourceId: row.id,
            changes: {
              providerId,
              serviceId: row.serviceId,
              fields: Object.keys(dto),
              active: row.active,
            },
          },
        });
        return presentProviderService(row);
      },
    );
  }
  update(providerId: string, id: string, dto: ProviderServiceDto) {
    return providerWrite(
      this.database,
      this.authorization,
      providerServicePermissions,
      async (tx, scope) => {
        const [row] = await tx.providerService.updateManyAndReturn({
          where: {
            id,
            providerId,
            ...providerWhere(scope, providerServicePermissions),
          },
          data: {
            active: dto.active,
            durationOverrideMinutes: dto.durationOverrideMinutes,
            priceOverride: dto.priceOverride,
          },
          select: providerServiceFields,
        });
        if (!row) throw new NotFoundException('Recurso não encontrado.');
        await recordAudit(tx, {
          data: {
            type: 'PROVIDER_SERVICE_UPDATED',
            userId: scope.userId,
            tenantId: scope.tenantId,
            resourceId: row.id,
            changes: {
              providerId,
              serviceId: row.serviceId,
              fields: Object.keys(dto),
              active: row.active,
            },
          },
        });
        return presentProviderService(row);
      },
    );
  }
}
