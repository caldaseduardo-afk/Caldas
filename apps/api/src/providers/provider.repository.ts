import { recordAudit } from '@atendente/database';
import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../auth/database.service';
import { AuthorizationService } from '../permissions/authorization.service';
import {
  providerWhere,
  providerWrite,
  providerFields,
  providerPermissions,
} from './provider-access';
import type { ProviderDto } from './provider.dto';
@Injectable()
export class ProviderRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}
  async list(filter: { active?: boolean }) {
    const scope = await this.authorization.requirePermissions(
      ...providerPermissions,
    );
    return this.database.client.provider.findMany({
      where: { ...providerWhere(scope), active: filter.active },
      select: providerFields,
      orderBy: { id: 'asc' },
    });
  }
  async find(id: string) {
    const scope = await this.authorization.requirePermissions(
      ...providerPermissions,
    );
    const row = await this.database.client.provider.findFirst({
      where: { id, ...providerWhere(scope) },
      select: providerFields,
    });
    if (!row) throw new NotFoundException('Recurso não encontrado.');
    return row;
  }
  create(dto: ProviderDto) {
    return providerWrite(
      this.database,
      this.authorization,
      providerPermissions,
      async (tx, scope) => {
        const row = await tx.provider.create({
          data: {
            tenantId: scope.tenantId,
            name: dto.name,
            professionalType: dto.professionalType,
            registrationNumber: dto.registrationNumber,
            active: dto.active,
          },
          select: providerFields,
        });
        await recordAudit(tx, {
          data: {
            type: 'PROVIDER_CREATED',
            userId: scope.userId,
            tenantId: scope.tenantId,
            resourceId: row.id,
            changes: { fields: Object.keys(dto), active: row.active },
          },
        });
        return row;
      },
    );
  }
  update(id: string, dto: Partial<ProviderDto>) {
    return providerWrite(
      this.database,
      this.authorization,
      providerPermissions,
      async (tx, scope) => {
        const [row] = await tx.provider.updateManyAndReturn({
          where: { id, ...providerWhere(scope) },
          data: {
            name: dto.name,
            professionalType: dto.professionalType,
            registrationNumber: dto.registrationNumber,
            active: dto.active,
          },
          select: providerFields,
        });
        if (!row) throw new NotFoundException('Recurso não encontrado.');
        await recordAudit(tx, {
          data: {
            type: 'PROVIDER_UPDATED',
            userId: scope.userId,
            tenantId: scope.tenantId,
            resourceId: row.id,
            changes: { fields: Object.keys(dto), active: row.active },
          },
        });
        return row;
      },
    );
  }
}
