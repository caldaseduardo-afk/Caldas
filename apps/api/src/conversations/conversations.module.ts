import { ConversationIngressService } from './conversation-ingress.service';
import { ConversationEngineEnqueuer } from './conversation-engine-enqueuer';
import { RealtimeEventsModule } from '../realtime/realtime.events';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { ConversationRepository } from './conversation.repository';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
@Module({
  imports: [RealtimeEventsModule, DatabaseModule, PermissionsModule],
  providers: [
    ConversationRepository,
    ConversationsService,
    ConversationIngressService,
    ConversationEngineEnqueuer,
  ],
  exports: [ConversationIngressService, ConversationsService],
  controllers: [ConversationsController],
})
export class ConversationsModule {}
