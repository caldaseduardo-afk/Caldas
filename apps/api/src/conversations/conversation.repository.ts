import { recordAudit } from '@atendente/database';
import {
  checkOperation,
  checkOperationDeadline,
} from '../permissions/operation-boundary';
import { getOrCreateConversation } from './conversation-create';
import {
  handoffPermissions,
  type HandoffAction,
  type handoffDto,
} from './handoff.dto';
import { eligibleAssignee } from './handoff-access';
import { RealtimeEvents, type EventDraft } from '../realtime/realtime.events';
import {
  Injectable,
  Optional,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import {
  databaseNow,
  startHumanSlaCycle,
  closeHumanSlaCycle,
  type PermissionName,
  type Prisma,
} from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import {
  AuthorizationService,
  authorizedTenantFilter,
  isConversationEngineScope,
} from '../permissions/authorization.service';
import type { TenantScope } from '../tenancy/tenant.context';
import {
  conversationWhere,
  conversationFields,
  messageFields,
  pageResult,
  viewPermissions,
  replyPermissions,
} from './conversation-access';
import {
  canAiRespond,
  assertOpen,
  assertConversationTransition,
} from './conversation.state';
import type {
  createConversationDto,
  contextDto,
  conversationStatusDto,
  conversationQuery,
  messageQuery,
  MessageData,
  receiptDto,
} from './conversation.dto';
// Canonical key ordering makes JSONB idempotency independent of object key order.
const canonical = (value: unknown): string =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? JSON.stringify(
        Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        ),
      )
    : JSON.stringify(value ?? null);
@Injectable()
export class ConversationRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    @Optional() private readonly events?: RealtimeEvents,
  ) {}
  private async requireInTransaction(
    tx: Prisma.TransactionClient,
    scope: TenantScope,
    permissions: readonly PermissionName[],
  ) {
    if (
      !(await tx.tenant.findFirst({
        where: authorizedTenantFilter(scope, permissions),
        select: { id: true },
      }))
    )
      throw new ForbiddenException('Permissão insuficiente.');
  }
  private async write<T>(
    permissions: readonly PermissionName[],
    fn: (
      tx: Prisma.TransactionClient,
      scope: TenantScope,
      pending: EventDraft[],
    ) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const scope = await this.authorization.requirePermissions(...permissions);
      try {
        const pending: EventDraft[] = [];
        const result = await this.database.client.$transaction(
          async (tx) => {
            await this.requireInTransaction(tx, scope, permissions);
            await checkOperation(tx, scope);
            const result = await fn(tx, scope, pending);
            checkOperationDeadline();
            return result;
          },
          { isolationLevel: 'Serializable' },
        );
        // Only the successful attempt publishes, strictly after COMMIT.
        for (const event of pending) {
          try {
            this.events?.publish(event);
          } catch {
            /* Delivery cannot undo a committed business operation. */
          }
        }
        return result;
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : '';
        if (['P2034', 'P2002'].includes(code) && attempt < 2) continue;
        if (['P2034', 'P2002', 'P2004'].includes(code))
          throw new ConflictException(
            'Operação conflitante ou alteração concorrente.',
          );
        throw error;
      }
    }
  }
  private audit(
    tx: Prisma.TransactionClient,
    scope: TenantScope,
    id: string,
    type: Prisma.AuthEventCreateInput['type'],
    changes: Prisma.InputJsonObject,
  ) {
    return recordAudit(tx, {
      data: {
        tenantId: scope.tenantId,
        userId: isConversationEngineScope(scope) ? null : scope.userId,
        resourceId: id,
        type,
        changes,
      },
    });
  }
  private async locked(
    tx: Prisma.TransactionClient,
    scope: TenantScope,
    permissions: readonly PermissionName[],
    id: string,
  ) {
    const [row] = await tx.conversation.updateManyAndReturn({
      where: { id, ...conversationWhere(scope, permissions) },
      data: { updatedAt: new Date() },
      select: conversationFields,
    });
    if (!row) throw new NotFoundException('Recurso não encontrado.');
    return row;
  }
  getOrCreate(dto: ReturnType<typeof createConversationDto>) {
    return this.write(replyPermissions, async (tx, scope, pending) => {
      const where = conversationWhere(scope, replyPermissions);
      const contact = await tx.contact.updateMany({
        where: { id: dto.contactId, ...where, status: 'ACTIVE' },
        data: { updatedAt: new Date() },
      });
      if (!contact.count)
        throw new NotFoundException('Recurso não encontrado.');
      return getOrCreateConversation(
        tx,
        scope.tenantId,
        dto.contactId,
        null,
        pending,
        scope.userId,
      );
    });
  }
  async list(query: ReturnType<typeof conversationQuery>) {
    const scope = await this.authorization.requirePermissions(
      ...viewPermissions,
    );
    const rows = await this.database.client.conversation.findMany({
      where: { ...conversationWhere(scope, viewPermissions), ...query.filter },
      select: conversationFields,
      orderBy: [
        { lastMessageAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      skip: (query.page - 1) * query.limit,
      take: query.limit + 1,
    });
    return pageResult(rows, query.page, query.limit);
  }
  async find(id: string) {
    const scope = await this.authorization.requirePermissions(
      ...viewPermissions,
    );
    const row = await this.database.client.conversation.findFirst({
      where: { id, ...conversationWhere(scope, viewPermissions) },
      select: conversationFields,
    });
    if (!row) throw new NotFoundException('Recurso não encontrado.');
    return row;
  }
  update(id: string, dto: ReturnType<typeof contextDto>) {
    const permissions = dto.activePatientId
      ? [...replyPermissions, 'patient.view' as const]
      : replyPermissions;
    return this.write(permissions, async (tx, scope, pending) => {
      const row = await this.locked(tx, scope, permissions, id);
      assertOpen(row.status);
      if (
        dto.activePatientId &&
        !(await tx.contactPatient.findFirst({
          where: {
            ...conversationWhere(scope, permissions),
            contactId: row.contactId,
            patientId: dto.activePatientId,
            active: true,
            relationshipStatus: 'VERIFIED',
            authorizationLevel: { in: ['FULL', 'SCHEDULING_ONLY'] },
            contact: { tenantId: scope.tenantId, status: 'ACTIVE' },
          },
          select: { id: true },
        }))
      )
        throw new NotFoundException('Recurso não encontrado.');
      const [updated] = await tx.conversation.updateManyAndReturn({
        where: { id, ...conversationWhere(scope, permissions) },
        data: dto,
        select: conversationFields,
      });
      if (!updated) throw new NotFoundException('Recurso não encontrado.');
      await this.audit(tx, scope, id, 'CONVERSATION_UPDATED', {
        fields: Object.keys(dto),
        ...(dto.intent ? { intent: dto.intent } : {}),
        ...('activePatientId' in dto
          ? { activePatientId: dto.activePatientId ?? null }
          : {}),
      });
      pending.push({
        type: 'conversation.updated',
        tenantId: scope.tenantId,
        conversationId: id,
      });
      if (
        'activePatientId' in dto &&
        row.activePatientId !== updated.activePatientId
      )
        pending.push({
          type: 'conversation.active_patient_changed',
          tenantId: scope.tenantId,
          conversationId: id,
        });
      return updated;
    });
  }
  transition(id: string, dto: ReturnType<typeof conversationStatusDto>) {
    const permissions: PermissionName[] = [
      ...replyPermissions,
      ...(['RESOLVED', 'CLOSED'].includes(dto.status)
        ? ['conversation.close' as const]
        : []),
      ...(dto.status === 'HUMAN_ACTIVE'
        ? ['conversation.assign' as const]
        : []),
    ];
    return this.write(permissions, async (tx, scope, pending) => {
      const row = await this.locked(tx, scope, permissions, id);
      assertConversationTransition(row.status, dto.status);
      if (
        row.status === 'HUMAN_ACTIVE' ||
        dto.status === 'HUMAN_ACTIVE' ||
        dto.status === 'NEEDS_HUMAN'
      )
        throw new ConflictException(
          'Use a operação de handoff correspondente.',
        );
      const [updated] = await tx.conversation.updateManyAndReturn({
        where: { id, ...conversationWhere(scope, permissions) },
        data: {
          ...dto,
          ...(dto.status === 'RESOLVED'
            ? { resolvedAt: await databaseNow(tx) }
            : {}),
        },
        select: conversationFields,
      });
      if (!updated) throw new NotFoundException('Recurso não encontrado.');
      await this.audit(tx, scope, id, 'CONVERSATION_STATUS_CHANGED', {
        from: row.status,
        to: updated.status,
        assignedUserId: updated.assignedUserId,
        handoffReason: updated.handoffReason,
      });
      pending.push({
        type: 'conversation.status_changed',
        tenantId: scope.tenantId,
        conversationId: id,
      });
      if (row.assignedUserId !== updated.assignedUserId)
        pending.push({
          type: 'conversation.assigned',
          tenantId: scope.tenantId,
          conversationId: id,
        });
      return updated;
    });
  }
  handoff(
    id: string,
    action: HandoffAction,
    dto: ReturnType<typeof handoffDto>,
  ) {
    const permissions = handoffPermissions(action);
    return this.write(permissions, async (tx, scope, pending) => {
      const row = await this.locked(tx, scope, permissions, id);
      const now = await databaseNow(tx);
      let data: Prisma.ConversationUncheckedUpdateManyInput;
      let type: Prisma.AuthEventCreateInput['type'];
      switch (action) {
        case 'request-human':
          if (
            !['AI_ACTIVE', 'WAITING_PATIENT'].includes(row.status) ||
            !dto.reason
          )
            throw new ConflictException(
              'Conversa não pode entrar na fila humana.',
            );
          data = {
            status: 'NEEDS_HUMAN',
            assignedUserId: null,
            assignedAt: null,
            handoffReason: dto.reason,
            handoffRequestedAt: now,
            resolvedAt: null,
          };
          type = 'HUMAN_HANDOFF_REQUESTED';
          break;
        case 'claim':
          if (row.status !== 'NEEDS_HUMAN' || row.assignedUserId)
            throw new ConflictException(
              'Conversa já assumida ou fora da fila humana.',
            );
          data = {
            status: 'HUMAN_ACTIVE',
            assignedUserId: scope.userId,
            assignedAt: now,
            handoffReason: null,
          };
          type = 'CONVERSATION_CLAIMED';
          break;
        case 'transfer':
          if (
            row.status !== 'HUMAN_ACTIVE' ||
            row.assignedUserId === dto.targetUserId
          )
            throw new ConflictException(
              'Transferência incompatível com o estado atual.',
            );
          if (
            !dto.targetUserId ||
            !(await tx.userTenant.findFirst({
              where: {
                ...eligibleAssignee(scope.tenantId),
                userId: dto.targetUserId,
                tenant: authorizedTenantFilter(scope, permissions),
              },
              select: { userId: true },
            }))
          )
            throw new NotFoundException('Responsável não encontrado.');
          data = { assignedUserId: dto.targetUserId, assignedAt: now };
          type = 'CONVERSATION_TRANSFERRED';
          break;
        default:
          if (row.status !== 'HUMAN_ACTIVE')
            throw new ConflictException(
              'Conversa não está em atendimento humano.',
            );
          if (row.assignedUserId !== scope.userId)
            throw new ForbiddenException(
              'Somente o responsável atual pode concluir o atendimento.',
            );
          data = {
            status: action === 'resolve' ? 'RESOLVED' : 'AI_ACTIVE',
            assignedUserId: null,
            assignedAt: null,
            handoffReason: null,
            ...(action === 'resolve'
              ? { resolvedAt: now }
              : { handoffRequestedAt: null, resolvedAt: null }),
          };
          type =
            action === 'resolve'
              ? 'CONVERSATION_RESOLVED'
              : 'CONVERSATION_RETURNED_TO_AI';
      }
      data.slaLevel = 'NONE';
      const [updated] = await tx.conversation.updateManyAndReturn({
        where: {
          id,
          ...conversationWhere(scope, permissions),
          status: row.status,
          assignedUserId: row.assignedUserId,
        },
        data,
        select: conversationFields,
      });
      if (!updated)
        throw new ConflictException('Conversa alterada por outro atendente.');
      if (action === 'request-human')
        await startHumanSlaCycle(tx, scope.tenantId, id, now);
      else if (
        await closeHumanSlaCycle(
          tx,
          scope.tenantId,
          id,
          now,
          action === 'claim',
          scope.userId,
        )
      )
        pending.push({
          type: 'conversation.sla_updated',
          tenantId: scope.tenantId,
          conversationId: id,
        });
      await this.audit(tx, scope, id, type, {
        from: row.status,
        to: updated.status,
        previousAssignee: row.assignedUserId,
        newAssignee: updated.assignedUserId,
        reason: dto.reason ?? row.handoffReason,
        at: now.toISOString(),
      });
      pending.push({
        type:
          row.status === updated.status
            ? 'conversation.updated'
            : 'conversation.status_changed',
        tenantId: scope.tenantId,
        conversationId: id,
      });
      if (row.assignedUserId !== updated.assignedUserId)
        pending.push({
          type: 'conversation.assigned',
          tenantId: scope.tenantId,
          conversationId: id,
        });
      return updated;
    });
  }
  persist(
    id: string,
    dto: MessageData,
    senderType: 'PATIENT' | 'AI' | 'USER' | 'SYSTEM',
  ) {
    return this.write(replyPermissions, async (tx, scope, pending) => {
      const row = await this.locked(tx, scope, replyPermissions, id);
      const where = conversationWhere(scope, replyPermissions);
      if (senderType === 'USER' && dto.requestId) {
        const existing = await tx.message.findFirst({
          where: {
            ...where,
            senderUserId: scope.userId,
            requestId: dto.requestId,
          },
          select: messageFields,
        });
        if (existing) {
          if (
            existing.conversationId !== id ||
            existing.content !== dto.content ||
            existing.messageType !== dto.messageType ||
            canonical(existing.metadata) !== canonical(dto.metadata)
          )
            throw new ConflictException('Chave de envio já utilizada.');
          return existing;
        }
      }
      let recipientAddress: string | undefined;
      if (senderType === 'USER' && row.integrationId) {
        if (!dto.requestId || dto.messageType !== 'TEXT')
          throw new ConflictException(
            'Envio integrado exige requestId e texto.',
          );
        const integration = await tx.integration.findFirst({
          where: {
            id: row.integrationId,
            tenantId: scope.tenantId,
            status: { in: ['ACTIVE', 'DEGRADED'] },
          },
        });
        const channel = await tx.contactChannel.findFirst({
          where: {
            tenantId: scope.tenantId,
            contactId: row.contactId,
            type: 'WHATSAPP',
          },
        });
        if (!integration || !channel)
          throw new ConflictException('Integração ou destino indisponível.');
        recipientAddress = channel.address;
      }
      if (senderType === 'PATIENT' && !dto.providerMessageId)
        throw new ConflictException('Mensagem externa exige identificador.');
      if (senderType !== 'PATIENT' && dto.providerMessageId)
        throw new ConflictException(
          'Identificador externo reservado ao ingresso.',
        );
      if (dto.providerMessageId) {
        const existing = await tx.message.findFirst({
          where: {
            ...where,
            channel: row.channel,
            integrationId: row.integrationId,
            providerMessageId: dto.providerMessageId,
          },
          select: messageFields,
        });
        if (existing) {
          if (
            existing.conversationId !== id ||
            existing.senderType !== senderType ||
            existing.messageType !== dto.messageType ||
            existing.content !== dto.content ||
            canonical(existing.metadata) !== canonical(dto.metadata)
          )
            throw new ConflictException('Identificador externo já utilizado.');
          return existing;
        }
      }
      assertOpen(row.status);
      if (
        senderType === 'USER' &&
        (row.status !== 'HUMAN_ACTIVE' || row.assignedUserId !== scope.userId)
      )
        throw new ForbiddenException(
          'Somente o responsável atual pode responder.',
        );
      if (senderType === 'AI' && !canAiRespond(row))
        throw new ConflictException('Conversa não está no estado de IA.');
      if (
        !(await tx.contact.findFirst({
          where: { id: row.contactId, ...where, status: 'ACTIVE' },
          select: { id: true },
        }))
      )
        throw new NotFoundException('Recurso não encontrado.');
      const createdAt = await databaseNow(tx);
      const message = await tx.message.create({
        data: {
          tenantId: scope.tenantId,
          conversationId: id,
          channel: row.channel,
          providerMessageId: dto.providerMessageId ?? null,
          integrationId: row.integrationId,
          requestId: senderType === 'USER' ? dto.requestId : undefined,
          ...(recipientAddress
            ? {
                deliveryStatus: 'PENDING',
                recipientAddress,
                nextAttemptAt: createdAt,
              }
            : {}),
          senderType,
          senderUserId: senderType === 'USER' ? scope.userId : null,
          messageType: dto.messageType,
          content: dto.content,
          ...(dto.metadata ? { metadata: dto.metadata } : {}),
          createdAt,
        },
        select: messageFields,
      });
      if (recipientAddress)
        await this.audit(tx, scope, message.id, 'MESSAGE_SEND_REQUESTED', {
          conversationId: id,
        });
      // AFTER INSERT updates lastMessageAt in the same transaction, including SQL writers.
      await this.audit(tx, scope, message.id, 'MESSAGE_CREATED', {
        conversationId: id,
        senderType,
        messageType: message.messageType,
      });
      pending.push({
        type: 'message.created',
        tenantId: scope.tenantId,
        conversationId: id,
        messageId: message.id,
      });
      return message;
    });
  }
  async messages(id: string, query: ReturnType<typeof messageQuery>) {
    const scope = await this.authorization.requirePermissions(
      ...viewPermissions,
    );
    const where = conversationWhere(scope, viewPermissions);
    if (
      !(await this.database.client.conversation.findFirst({
        where: { id, ...where },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Recurso não encontrado.');
    const rows = await this.database.client.message.findMany({
      where: { ...where, conversationId: id },
      select: messageFields,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit + 1,
    });
    return pageResult(rows, query.page, query.limit);
  }
  async message(id: string, messageId: string) {
    const scope = await this.authorization.requirePermissions(
      ...viewPermissions,
    );
    const row = await this.database.client.message.findFirst({
      where: {
        id: messageId,
        conversationId: id,
        ...conversationWhere(scope, viewPermissions),
      },
      select: messageFields,
    });
    if (!row) throw new NotFoundException('Recurso não encontrado.');
    return row;
  }
  receipt(id: string, messageId: string, dto: ReturnType<typeof receiptDto>) {
    return this.write(replyPermissions, async (tx, scope, pending) => {
      await this.locked(tx, scope, replyPermissions, id);
      const where = {
        id: messageId,
        conversationId: id,
        ...conversationWhere(scope, replyPermissions),
      };
      const row = await tx.message.findFirst({ where, select: messageFields });
      if (!row) throw new NotFoundException('Recurso não encontrado.');
      if (!['AI', 'USER'].includes(row.senderType))
        throw new ConflictException('Recibo não se aplica à mensagem.');
      const now = await databaseNow(tx);
      if (dto.at < row.createdAt || dto.at > now)
        throw new ConflictException('Ordem temporal inválida.');
      const previous = dto.kind === 'DELIVERED' ? row.deliveredAt : row.readAt;
      if (previous) {
        if (+previous === +dto.at) return row;
        throw new ConflictException('Recibo já registrado.');
      }
      if (dto.kind === 'READ' && row.deliveredAt && dto.at < row.deliveredAt)
        throw new ConflictException('Leitura anterior à entrega.');
      const data =
        dto.kind === 'DELIVERED'
          ? { deliveredAt: dto.at }
          : { readAt: dto.at, deliveredAt: row.deliveredAt ?? dto.at };
      const [updated] = await tx.message.updateManyAndReturn({
        where,
        data,
        select: messageFields,
      });
      if (!updated) throw new NotFoundException('Recurso não encontrado.');
      await this.audit(tx, scope, messageId, 'MESSAGE_RECEIPT_UPDATED', {
        conversationId: id,
        kind: dto.kind,
      });
      pending.push({
        type: dto.kind === 'READ' ? 'message.read' : 'message.delivered',
        tenantId: scope.tenantId,
        conversationId: id,
        messageId,
      });
      return updated;
    });
  }
}
