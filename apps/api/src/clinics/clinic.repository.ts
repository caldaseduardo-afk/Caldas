import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../auth/database.service';
import {
  AuthorizationService,
  authorizedTenantFilter,
} from '../permissions/authorization.service';
import { configurationWrite } from '../configuration/configuration-write';
import type { UpdateClinicDto } from './clinic.dto';

@Injectable()
export class ClinicRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}
  async list() {
    const scope = await this.authorization.requirePermissions('tenant.view');
    return this.database.client.tenant.findMany({
      where: authorizedTenantFilter(scope, ['tenant.view']),
    });
  }
  async find(id: string) {
    const scope = await this.authorization.requirePermissions('tenant.view');
    const tenant = await this.database.client.tenant.findFirst({
      where: { AND: [{ id }, authorizedTenantFilter(scope, ['tenant.view'])] },
    });
    if (!tenant) throw new NotFoundException('Recurso não encontrado.');
    return tenant;
  }
  update(id: string, dto: UpdateClinicDto) {
    return configurationWrite(
      this.database,
      this.authorization,
      async (tx, scope) => {
        const where = {
          AND: [{ id }, authorizedTenantFilter(scope, ['settings.manage'])],
        };
        const before = await tx.tenant.findFirst({ where });
        if (!before) throw new NotFoundException('Recurso não encontrado.');
        const [tenant] = await tx.tenant.updateManyAndReturn({
          where,
          data: { name: dto.name, status: dto.status, timezone: dto.timezone },
        });
        if (!tenant) throw new NotFoundException('Recurso não encontrado.');
        await tx.authEvent.create({
          data: {
            type:
              tenant.status === 'INACTIVE'
                ? 'TENANT_DEACTIVATED'
                : 'TENANT_UPDATED',
            userId: scope.userId,
            tenantId: scope.tenantId,
            resourceId: tenant.id,
            changes: {
              before: {
                name: before.name,
                status: before.status,
                timezone: before.timezone,
              },
              after: {
                name: tenant.name,
                status: tenant.status,
                timezone: tenant.timezone,
              },
            },
          },
        });
        return tenant;
      },
    );
  }
}
