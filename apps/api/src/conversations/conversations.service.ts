import { messagingLog } from '@atendente/database';
import {
  handoffDto,
  handoffPermissions,
  type HandoffAction,
} from './handoff.dto';
import { Injectable } from '@nestjs/common';
import { AuthorizationService } from '../permissions/authorization.service';
import { ConversationRepository } from './conversation.repository';
import { viewPermissions, replyPermissions } from './conversation-access';
import {
  createConversationDto,
  contextDto,
  conversationStatusDto,
  conversationQuery,
  messageQuery,
  messageDto,
  receiptDto,
} from './conversation.dto';
@Injectable()
export class ConversationsService {
  constructor(
    private readonly repository: ConversationRepository,
    private readonly authorization: AuthorizationService,
  ) {}
  async getOrCreate(body: unknown) {
    await this.authorization.requirePermissions(...replyPermissions);
    return this.repository.getOrCreate(createConversationDto(body));
  }
  async list(query: unknown) {
    await this.authorization.requirePermissions(...viewPermissions);
    return this.repository.list(conversationQuery(query));
  }
  async find(id: string) {
    await this.authorization.requirePermissions(...viewPermissions);
    return this.repository.find(id);
  }
  async update(id: string, body: unknown) {
    await this.authorization.requirePermissions(...replyPermissions);
    return this.repository.update(id, contextDto(body));
  }
  async status(id: string, body: unknown) {
    await this.authorization.requirePermissions(...replyPermissions);
    return this.repository.transition(id, conversationStatusDto(body));
  }
  async handoff(id: string, action: HandoffAction, body: unknown) {
    await this.authorization.requirePermissions(...handoffPermissions(action));
    return this.repository.handoff(id, action, handoffDto(action, body));
  }
  async reply(id: string, body: unknown) {
    const scope = await this.authorization.requirePermissions(
      ...replyPermissions,
    );
    const started = Date.now();
    const message = await this.repository.persist(id, messageDto(body), 'USER');
    if (message.deliveryStatus === 'PENDING')
      messagingLog('send_requested', {
        correlationId: message.id,
        tenantId: scope.tenantId,
        result: 'PENDING',
        durationMs: Date.now() - started,
      });
    return message;
  }
  async messages(id: string, query: unknown) {
    await this.authorization.requirePermissions(...viewPermissions);
    return this.repository.messages(id, messageQuery(query));
  }
  async message(id: string, messageId: string) {
    await this.authorization.requirePermissions(...viewPermissions);
    return this.repository.message(id, messageId);
  }
  // Internal entry points only: no routes for external authors or receipts.
  // Returning successfully means message + lastMessageAt + audit have committed.
  async persistIncoming(id: string, body: unknown) {
    await this.authorization.requirePermissions(...replyPermissions);
    return this.repository.persist(id, messageDto(body, true), 'PATIENT');
  }
  async persistAssistant(id: string, body: unknown) {
    await this.authorization.requirePermissions(...replyPermissions);
    return this.repository.persist(id, messageDto(body), 'AI');
  }
  async persistSystem(id: string, body: unknown) {
    await this.authorization.requirePermissions(...replyPermissions);
    return this.repository.persist(id, messageDto(body), 'SYSTEM');
  }
  async internalStatus(id: string, body: unknown) {
    await this.authorization.requirePermissions(...replyPermissions);
    return this.repository.transition(id, conversationStatusDto(body, true));
  }
  async recordReceipt(id: string, messageId: string, body: unknown) {
    await this.authorization.requirePermissions(...replyPermissions);
    return this.repository.receipt(id, messageId, receiptDto(body));
  }
}
