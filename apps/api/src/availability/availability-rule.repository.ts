import { recordAudit } from '@atendente/database';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import { AuthorizationService } from '../permissions/authorization.service';
import type { TenantScope } from '../tenancy/tenant.context';
import {
  availabilityPermissions,
  availabilityWhere,
  availabilityWrite,
  checkFilters,
  lockPair,
  ruleFields,
  presentRule,
} from './availability-access';
import {
  validateRule,
  type RuleData,
  type Pair,
  type AvailabilityFilter,
} from './availability.dto';
const data = (dto: RuleData) => ({
  weekday: dto.weekday,
  startTime: dto.startTime,
  endTime: dto.endTime,
  validFrom: dto.validFrom,
  validUntil: dto.validUntil,
  active: dto.active,
});
async function checkOverlap(
  tx: Prisma.TransactionClient,
  scope: TenantScope,
  dto: RuleData & Pair,
  id?: string,
) {
  if (!dto.active) return;
  const conflict = await tx.availabilityRule.findFirst({
    where: {
      ...availabilityWhere(scope),
      id: id ? { not: id } : undefined,
      providerId: dto.providerId,
      unitId: dto.unitId,
      weekday: dto.weekday,
      active: true,
      startTime: { lt: dto.endTime },
      endTime: { gt: dto.startTime },
      validFrom: dto.validUntil ? { lte: dto.validUntil } : undefined,
      OR: [{ validUntil: null }, { validUntil: { gte: dto.validFrom } }],
    },
    select: { id: true },
  });
  if (conflict)
    throw new ConflictException('Regras de disponibilidade sobrepostas.');
}
@Injectable()
export class AvailabilityRuleRepository {
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
      await this.database.client.availabilityRule.findMany({
        where: {
          ...availabilityWhere(scope),
          providerId: filter.providerId,
          unitId: filter.unitId,
          active: filter.active,
        },
        select: ruleFields,
        orderBy: { id: 'asc' },
      })
    ).map(presentRule);
  }
  async find(id: string) {
    const scope = await this.authorization.requirePermissions(
      ...availabilityPermissions,
    );
    const row = await this.database.client.availabilityRule.findFirst({
      where: { id, ...availabilityWhere(scope) },
      select: ruleFields,
    });
    if (!row) throw new NotFoundException('Recurso não encontrado.');
    return presentRule(row);
  }
  create(dto: RuleData & Pair) {
    return availabilityWrite(
      this.database,
      this.authorization,
      async (tx, scope) => {
        validateRule(dto);
        await lockPair(tx, scope, dto, dto.active);
        await checkOverlap(tx, scope, dto);
        const row = await tx.availabilityRule.create({
          data: {
            tenantId: scope.tenantId,
            providerId: dto.providerId,
            unitId: dto.unitId,
            ...data(dto),
          },
          select: ruleFields,
        });
        await recordAudit(tx, {
          data: {
            type: 'AVAILABILITY_RULE_CREATED',
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
        return presentRule(row);
      },
    );
  }
  update(id: string, dto: Partial<RuleData>) {
    return availabilityWrite(
      this.database,
      this.authorization,
      async (tx, scope) => {
        const where = { id, ...availabilityWhere(scope) };
        const before = await tx.availabilityRule.findFirst({
          where,
          select: ruleFields,
        });
        if (!before) throw new NotFoundException('Recurso não encontrado.');
        const merged = { ...before, ...dto };
        validateRule(merged);
        await lockPair(tx, scope, before, merged.active);
        await checkOverlap(tx, scope, merged, id);
        const [row] = await tx.availabilityRule.updateManyAndReturn({
          where,
          data: data(merged),
          select: ruleFields,
        });
        if (!row) throw new NotFoundException('Recurso não encontrado.');
        await recordAudit(tx, {
          data: {
            type: 'AVAILABILITY_RULE_UPDATED',
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
        return presentRule(row);
      },
    );
  }
}
