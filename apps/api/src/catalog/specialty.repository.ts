import { recordAudit } from '@atendente/database';
import { authorizedTenantFilter } from '../permissions/authorization.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../auth/database.service';
import { AuthorizationService } from '../permissions/authorization.service';
import { catalogWhere, catalogWrite, specialtyFields } from './catalog-access';
import type { CatalogFilter, SpecialtyDto } from './catalog.dto';
@Injectable()
export class SpecialtyRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}
  async forAttendance() {
    const scope =
      await this.authorization.requirePermissions('appointment.view');
    const where = {
      tenantId: scope.tenantId,
      tenant: authorizedTenantFilter(scope, ['appointment.view']),
    };
    return this.database.client.specialty.findMany({
      where: { ...where, active: true },
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
      take: 100,
    });
  }
  async list(filter: CatalogFilter) {
    const scope = await this.authorization.requirePermissions('service.manage');
    return this.database.client.specialty.findMany({
      where: { ...catalogWhere(scope), active: filter.active },
      select: specialtyFields,
      orderBy: { id: 'asc' },
    });
  }
  async find(id: string) {
    const scope = await this.authorization.requirePermissions('service.manage');
    const row = await this.database.client.specialty.findFirst({
      where: { id, ...catalogWhere(scope) },
      select: specialtyFields,
    });
    if (!row) throw new NotFoundException('Recurso não encontrado.');
    return row;
  }
  create(dto: SpecialtyDto) {
    return catalogWrite(
      this.database,
      this.authorization,
      async (tx, scope) => {
        const row = await tx.specialty.create({
          data: {
            tenantId: scope.tenantId,
            name: dto.name,
            description: dto.description,
            active: dto.active,
          },
          select: specialtyFields,
        });
        await recordAudit(tx, {
          data: {
            type: 'SPECIALTY_CREATED',
            tenantId: scope.tenantId,
            userId: scope.userId,
            resourceId: row.id,
            changes: { fields: Object.keys(dto), active: row.active },
          },
        });
        return row;
      },
    );
  }
  update(id: string, dto: Partial<SpecialtyDto>) {
    return catalogWrite(
      this.database,
      this.authorization,
      async (tx, scope) => {
        const [row] = await tx.specialty.updateManyAndReturn({
          where: { id, ...catalogWhere(scope) },
          data: {
            name: dto.name,
            description: dto.description,
            active: dto.active,
          },
          select: specialtyFields,
        });
        if (!row) throw new NotFoundException('Recurso não encontrado.');
        await recordAudit(tx, {
          data: {
            type: 'SPECIALTY_UPDATED',
            tenantId: scope.tenantId,
            userId: scope.userId,
            resourceId: row.id,
            changes: { fields: Object.keys(dto), active: row.active },
          },
        });
        return row;
      },
    );
  }
}
