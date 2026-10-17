import { messageQuery } from '../conversations/conversation.dto';
import { Injectable } from '@nestjs/common';
import { AuthorizationService } from '../permissions/authorization.service';
import { viewPermissions } from '../conversations/conversation-access';
import { InboxRepository } from './inbox.repository';
import { inboxQuery, historyQuery } from './inbox.dto';
@Injectable()
export class InboxService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly repository: InboxRepository,
  ) {}
  async session() {
    return this.repository.session(
      await this.authorization.requirePermissions(...viewPermissions),
    );
  }
  async assignees(query: unknown) {
    return this.repository.assignees(
      await this.authorization.requirePermissions(
        ...viewPermissions,
        'conversation.transfer',
      ),
      messageQuery(query),
    );
  }
  async list(query: unknown) {
    return this.repository.list(
      await this.authorization.requirePermissions(...viewPermissions),
      inboxQuery(query),
    );
  }
  async detail(id: string) {
    return this.repository.detail(
      await this.authorization.requirePermissions(...viewPermissions),
      id,
    );
  }
  async history(id: string, query: unknown) {
    return this.repository.history(
      await this.authorization.requirePermissions(...viewPermissions),
      id,
      historyQuery(query),
    );
  }
}
