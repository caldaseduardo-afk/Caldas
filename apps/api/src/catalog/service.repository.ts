import { recordAudit } from '@atendente/database';
import { authorizedTenantFilter } from '../permissions/authorization.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../auth/database.service';
import { AuthorizationService } from '../permissions/authorization.service';
import {
  catalogWhere,
  catalogWrite,
  serviceFields,
  presentService,
} from './catalog-access';
import type { CatalogFilter, ServiceDto } from './catalog.dto';
@Injectable()
export class ServiceRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}
  async forAttendance(specialtyId?: string) {
    const scope =
      await this.authorization.requirePermissions('appointment.view');
    const where = {
      tenantId: scope.tenantId,
      tenant: authorizedTenantFilter(scope, ['appointment.view']),
    };
    if (
      specialtyId &&
      !(await this.database.client.specialty.findFirst({
        where: { ...where, id: specialtyId, active: true },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Recurso não encontrado.');
    return this.database.client.service.findMany({
      where: {
        ...where,
        active: true,
        specialtyId,
        specialty: { active: true },
      },
      select: { id: true, name: true, durationMinutes: true },
      orderBy: { id: 'asc' },
      take: 100,
    });
  }
  async list(filter: CatalogFilter) {
    const scope = await this.authorization.requirePermissions('service.manage');
    if (
      filter.specialtyId &&
      !(await this.database.client.specialty.findFirst({
        where: { id: filter.specialtyId, ...catalogWhere(scope) },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Recurso não encontrado.');
    return (
      await this.database.client.service.findMany({
        where: {
          ...catalogWhere(scope),
          active: filter.active,
          specialtyId: filter.specialtyId,
        },
        select: serviceFields,
        orderBy: { id: 'asc' },
      })
    ).map(presentService);
  }
  async find(id: string) {
    const scope = await this.authorization.requirePermissions('service.manage');
    const row = await this.database.client.service.findFirst({
      where: { id, ...catalogWhere(scope) },
      select: serviceFields,
    });
    if (!row) throw new NotFoundException('Recurso não encontrado.');
    return presentService(row);
  }
  create(dto: ServiceDto) {
    return catalogWrite(
      this.database,
      this.authorization,
      async (tx, scope) => {
        if (
          !(await tx.specialty.findFirst({
            where: { id: dto.specialtyId, ...catalogWhere(scope) },
            select: { id: true },
          }))
        )
          throw new NotFoundException('Recurso não encontrado.');
        const row = await tx.service.create({
          data: {
            tenantId: scope.tenantId,
            specialtyId: dto.specialtyId,
            name: dto.name,
            description: dto.description,
            active: dto.active,
            durationMinutes: dto.durationMinutes,
            bufferBeforeMinutes: dto.bufferBeforeMinutes,
            bufferAfterMinutes: dto.bufferAfterMinutes,
            price: dto.price,
          },
          select: serviceFields,
        });
        await recordAudit(tx, {
          data: {
            type: 'SERVICE_CREATED',
            tenantId: scope.tenantId,
            userId: scope.userId,
            resourceId: row.id,
            changes: {
              fields: Object.keys(dto),
              active: row.active,
              specialtyId: row.specialtyId,
            },
          },
        });
        return presentService(row);
      },
    );
  }
  update(id: string, dto: Partial<ServiceDto>) {
    return catalogWrite(
      this.database,
      this.authorization,
      async (tx, scope) => {
        const where = { id, ...catalogWhere(scope) };
        const before = await tx.service.findFirst({
          where,
          select: { specialtyId: true },
        });
        if (!before) throw new NotFoundException('Recurso não encontrado.');
        if (
          dto.specialtyId &&
          !(await tx.specialty.findFirst({
            where: { id: dto.specialtyId, ...catalogWhere(scope) },
            select: { id: true },
          }))
        )
          throw new NotFoundException('Recurso não encontrado.');
        const [row] = await tx.service.updateManyAndReturn({
          where,
          data: {
            specialtyId: dto.specialtyId,
            name: dto.name,
            description: dto.description,
            active: dto.active,
            durationMinutes: dto.durationMinutes,
            bufferBeforeMinutes: dto.bufferBeforeMinutes,
            bufferAfterMinutes: dto.bufferAfterMinutes,
            price: dto.price,
          },
          select: serviceFields,
        });
        if (!row) throw new NotFoundException('Recurso não encontrado.');
        await recordAudit(tx, {
          data: {
            type: 'SERVICE_UPDATED',
            tenantId: scope.tenantId,
            userId: scope.userId,
            resourceId: row.id,
            changes: {
              fields: Object.keys(dto),
              active: row.active,
              previousSpecialtyId: before.specialtyId,
              specialtyId: row.specialtyId,
            },
          },
        });
        return presentService(row);
      },
    );
  }
}
