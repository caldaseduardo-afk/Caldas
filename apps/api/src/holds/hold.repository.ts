import { recordAudit } from '@atendente/database';
import {
  checkOperation,
  checkOperationDeadline,
} from '../permissions/operation-boundary';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  databaseNow,
  type Prisma,
  type PermissionName,
} from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import {
  AuthorizationService,
  authorizedTenantFilter,
  isConversationEngineScope,
} from '../permissions/authorization.service';
import type { TenantScope } from '../tenancy/tenant.context';
import { HoldConfig } from './hold.config';
import {
  createPermissions,
  readPermissions,
  releasePermissions,
  holdWhere,
  holdFields,
  effectiveHold,
} from './hold-access';
import {
  lockResource,
  validateSchedule,
  assertNoConflict,
} from '../scheduling/schedule';
import type { CreateHoldDto, activeHoldsQuery } from './hold.dto';

@Injectable()
export class HoldRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly config: HoldConfig,
  ) {}
  private async write<T>(
    permissions: PermissionName[],
    execute: (tx: Prisma.TransactionClient, scope: TenantScope) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const scope = await this.authorization.requirePermissions(...permissions);
      try {
        return await this.database.client.$transaction(
          async (tx) => {
            if (
              !(await tx.tenant.findFirst({
                where: authorizedTenantFilter(scope, permissions),
                select: { id: true },
              }))
            )
              throw new ForbiddenException('Permissão insuficiente.');
            await checkOperation(tx, scope);
            const result = await execute(tx, scope);
            checkOperationDeadline();
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : '';
        if (['P2034', 'P2002'].includes(code) && attempt < 2) continue;
        if (['P2034', 'P2002', 'P2004'].includes(code))
          throw new ConflictException(
            'Conflito de horário ou alteração concorrente.',
          );
        throw error;
      }
    }
  }
  create(dto: CreateHoldDto) {
    const permissions = dto.contactId
      ? [...createPermissions, 'contact.view' as const]
      : [...createPermissions];
    return this.write(permissions, async (tx, scope) => {
      const where = holdWhere(scope, permissions);
      const locked = await lockResource(tx, scope, permissions, dto);
      const { now } = locked;
      const existing = await tx.appointmentHold.findFirst({
        where: { ...where, requestId: dto.requestId },
        select: { ...holdFields, creatorId: true, createdByType: true },
      });
      if (existing) {
        if (
          existing.creatorId !==
            (isConversationEngineScope(scope) ? null : scope.userId) ||
          existing.createdByType !==
            (isConversationEngineScope(scope) ? 'AI' : 'USER') ||
          existing.patientId !== dto.patientId ||
          existing.contactId !== dto.contactId ||
          existing.serviceId !== dto.serviceId ||
          existing.providerId !== dto.providerId ||
          existing.unitId !== dto.unitId ||
          +existing.startAt !== +dto.startAt ||
          (dto.endAt && +dto.endAt !== +existing.endAt)
        )
          throw new ConflictException('Chave de operação já utilizada.');
        const {
          creatorId: _creator,
          createdByType: _actor,
          ...result
        } = existing;
        void _creator;
        void _actor;
        return effectiveHold(result, now);
      }
      const { endAt, occupiedStartAt, occupiedEndAt } = await validateSchedule(
        tx,
        scope,
        permissions,
        dto,
        locked,
      );
      await assertNoConflict(
        tx,
        scope,
        permissions,
        { ...dto, occupiedStartAt, occupiedEndAt },
        now,
      );
      const expiresAt = new Date(
        Math.min(+now + this.config.ttlSeconds * 1000, +dto.startAt),
      );
      const row = await tx.appointmentHold.create({
        data: {
          tenantId: scope.tenantId,
          patientId: dto.patientId,
          contactId: dto.contactId,
          serviceId: dto.serviceId,
          providerId: dto.providerId,
          unitId: dto.unitId,
          creatorId: isConversationEngineScope(scope) ? null : scope.userId,
          createdByType: isConversationEngineScope(scope) ? 'AI' : 'USER',
          requestId: dto.requestId,
          startAt: dto.startAt,
          endAt,
          occupiedStartAt,
          occupiedEndAt,
          expiresAt,
          createdAt: now,
          status: 'ACTIVE',
        },
        select: holdFields,
      });
      await recordAudit(tx, {
        data: {
          type: 'HOLD_CREATED',
          userId: isConversationEngineScope(scope) ? null : scope.userId,
          tenantId: scope.tenantId,
          resourceId: row.id,
          changes: { status: 'ACTIVE' },
        },
      });
      return row;
    });
  }
  async find(id: string) {
    const scope = await this.authorization.requirePermissions(
      ...readPermissions,
    );
    const row = await this.database.client.appointmentHold.findFirst({
      where: { id, ...holdWhere(scope, readPermissions) },
      select: holdFields,
    });
    if (!row) throw new NotFoundException('Recurso não encontrado.');
    return effectiveHold(row, await databaseNow(this.database.client));
  }
  async active(query: ReturnType<typeof activeHoldsQuery>) {
    const scope = await this.authorization.requirePermissions(
      ...readPermissions,
    );
    const where = holdWhere(scope, readPermissions);
    if (
      !(await this.database.client.providerUnit.findFirst({
        where: { ...where, providerId: query.providerId, unitId: query.unitId },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Recurso não encontrado.');
    const now = await databaseNow(this.database.client);
    return this.database.client.appointmentHold.findMany({
      where: {
        ...where,
        providerId: query.providerId,
        unitId: query.unitId,
        status: 'ACTIVE',
        expiresAt: { gt: now },
        occupiedStartAt: { lt: query.endAt },
        occupiedEndAt: { gt: query.startAt },
      },
      select: { id: true, startAt: true, endAt: true, expiresAt: true },
      orderBy: { startAt: 'asc' },
    });
  }
  release(id: string) {
    return this.write([...releasePermissions], async (tx, scope) => {
      const where = { id, ...holdWhere(scope, releasePermissions) };
      const row = await tx.appointmentHold.findFirst({
        where,
        select: holdFields,
      });
      if (!row) throw new NotFoundException('Recurso não encontrado.');
      if (row.status === 'CONSUMED')
        throw new ConflictException('HOLD já consumido.');
      if (row.status !== 'ACTIVE') return row;
      const now = await databaseNow(tx);
      const status = row.expiresAt <= now ? 'EXPIRED' : 'RELEASED';
      const [updated] = await tx.appointmentHold.updateManyAndReturn({
        where: { ...where, status: 'ACTIVE' },
        data: { status },
        select: holdFields,
      });
      if (!updated)
        throw new ConflictException('HOLD alterado simultaneamente.');
      await recordAudit(tx, {
        data: {
          type: status === 'EXPIRED' ? 'HOLD_EXPIRED' : 'HOLD_RELEASED',
          userId: isConversationEngineScope(scope) ? null : scope.userId,
          tenantId: scope.tenantId,
          resourceId: id,
          changes: { status },
        },
      });
      return updated;
    });
  }
}
