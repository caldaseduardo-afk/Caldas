import type { Prisma, PermissionName } from '@atendente/database';
import type { TenantScope } from '../tenancy/tenant.context';
import { authorizedTenantFilter } from '../permissions/authorization.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../auth/database.service';
import { AuthorizationService } from '../permissions/authorization.service';
import { availabilityPermissions } from './availability-access';
import { weekdayOf } from './availability.dto';
@Injectable()
export class AvailabilityRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}
  async load(providerId: string, unitId: string, date: Date) {
    const scope = await this.authorization.requirePermissions(
      ...availabilityPermissions,
    );
    return loadStructuralAvailability(
      this.database.client,
      scope,
      availabilityPermissions,
      providerId,
      unitId,
      date,
    );
  }
}

// Mesma consulta estrutural, com transação/escopo/permissões explícitos do chamador.
export async function loadStructuralAvailability(
  tx: Prisma.TransactionClient,
  scope: TenantScope,
  permissions: readonly PermissionName[],
  providerId: string,
  unitId: string,
  date: Date,
) {
  const where = {
    tenantId: scope.tenantId,
    tenant: authorizedTenantFilter(scope, permissions),
  };
  // Relações compostas mantêm tenant; calendário civil usa a data recebida na unidade.
  const row = await tx.providerUnit.findFirst({
    where: { providerId, unitId, ...where },
    select: {
      active: true,
      provider: { select: { active: true } },
      unit: { select: { active: true, timezoneOverride: true } },
      tenant: { select: { timezone: true } },
      availabilityRules: {
        where: {
          ...where,
          active: true,
          weekday: weekdayOf(date),
          validFrom: { lte: date },
          OR: [{ validUntil: null }, { validUntil: { gte: date } }],
        },
        select: { startTime: true, endTime: true },
      },
      scheduleExceptions: {
        where: { ...where, active: true, date },
        select: { type: true, startTime: true, endTime: true },
      },
    },
  });
  if (!row) throw new NotFoundException('Recurso não encontrado.');
  return row;
}
