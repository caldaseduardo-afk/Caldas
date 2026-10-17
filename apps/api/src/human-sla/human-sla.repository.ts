import { recordAudit } from '@atendente/database';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { humanSlaSchedule, type HumanSlaConfig } from '@atendente/domain';
import {
  closeHumanSlaCycle,
  databaseNow,
  type Prisma,
} from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import {
  AuthorizationService,
  authorizedTenantFilter,
} from '../permissions/authorization.service';
import { RealtimeEvents } from '../realtime/realtime.events';
import { validateSla } from './human-sla.dto';
const permissions = ['settings.manage'] as const;
const select = {
  id: true,
  firstAlertMinutes: true,
  secondAlertMinutes: true,
  externalAlertMinutes: true,
  internalAlertEnabled: true,
  externalAlertEnabled: true,
  active: true,
} as const;
@Injectable()
export class HumanSlaRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly events: RealtimeEvents,
  ) {}
  async list() {
    const scope = await this.authorization.requirePermissions(...permissions);
    return this.database.client.humanSlaRule.findMany({
      where: {
        tenantId: scope.tenantId,
        tenant: authorizedTenantFilter(scope, permissions),
      },
      select,
    });
  }
  async find(id: string) {
    const scope = await this.authorization.requirePermissions(...permissions);
    const rule = await this.database.client.humanSlaRule.findFirst({
      where: {
        id,
        tenantId: scope.tenantId,
        tenant: authorizedTenantFilter(scope, permissions),
      },
      select,
    });
    if (!rule) throw new NotFoundException('Regra não encontrada.');
    return rule;
  }
  async preview(id: string, requestedAt: Date) {
    return {
      requestedAt,
      alerts: humanSlaSchedule(requestedAt, await this.find(id)),
    };
  }
  async save(id: string | undefined, dto: Partial<HumanSlaConfig>) {
    for (let attempt = 0; ; attempt++) {
      const scope = await this.authorization.requirePermissions(...permissions);
      try {
        const result = await this.database.client.$transaction(
          async (tx) => {
            const where = {
              tenantId: scope.tenantId,
              tenant: authorizedTenantFilter(scope, permissions),
            };
            if (
              !(await tx.tenant.findFirst({
                where: authorizedTenantFilter(scope, permissions),
                select: { id: true },
              }))
            )
              throw new ForbiddenException();
            const existing = id
              ? await tx.humanSlaRule.findFirst({
                  where: { ...where, id },
                  select,
                })
              : null;
            if (id && !existing)
              throw new NotFoundException('Regra não encontrada.');
            const data = { ...existing, ...dto } as HumanSlaConfig;
            validateSla(data);
            const saved = id
              ? (
                  await tx.humanSlaRule.updateManyAndReturn({
                    where: { ...where, id },
                    data: dto,
                    select,
                  })
                )[0]
              : await tx.humanSlaRule.create({
                  data: {
                    tenantId: scope.tenantId,
                    ...dto,
                  } as Prisma.HumanSlaRuleUncheckedCreateInput,
                  select,
                });
            if (!saved) throw new NotFoundException('Regra não encontrada.');
            const cleared: string[] = [];
            if (existing?.active && !saved.active) {
              const cycles = await tx.humanSlaCycle.findMany({
                where: {
                  tenantId: scope.tenantId,
                  ruleId: saved.id,
                  endedAt: null,
                },
                select: { conversationId: true },
                orderBy: { conversationId: 'asc' },
              });
              for (const cycle of cycles) {
                await tx.conversation.updateMany({
                  where: { ...where, id: cycle.conversationId },
                  data: { updatedAt: new Date() },
                });
                if (
                  await closeHumanSlaCycle(
                    tx,
                    scope.tenantId,
                    cycle.conversationId,
                    await databaseNow(tx),
                    false,
                    scope.userId,
                  )
                )
                  cleared.push(cycle.conversationId);
              }
            }
            await recordAudit(tx, {
              data: {
                type: id ? 'HUMAN_SLA_RULE_UPDATED' : 'HUMAN_SLA_RULE_CREATED',
                tenantId: scope.tenantId,
                userId: scope.userId,
                resourceId: saved.id,
                changes: { fields: Object.keys(dto), active: saved.active },
              },
            });
            return { saved, cleared };
          },
          { isolationLevel: 'Serializable' },
        );
        for (const conversationId of result.cleared)
          this.events.publish({
            type: 'conversation.sla_updated',
            tenantId: scope.tenantId,
            conversationId,
          });
        return result.saved;
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : '';
        if (code === 'P2034' && attempt < 3) continue;
        if (['P2034', 'P2002'].includes(code))
          throw new ConflictException(
            'Regra existente ou alteração concorrente.',
          );
        throw error;
      }
    }
  }
}
