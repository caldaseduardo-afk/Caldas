import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { RealtimeEventsModule } from '../realtime/realtime.events';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { MessagingBridge } from './messaging.bridge';
@Module({
  imports: [ConversationsModule, RealtimeEventsModule],
  controllers: [WhatsAppWebhookController],
  providers: [MessagingBridge],
})
export class MessagingModule {}
