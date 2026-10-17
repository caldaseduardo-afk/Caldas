import {
  Injectable,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { subscribeMessagingUpdates } from '@atendente/database';
import { RealtimeEvents } from '../realtime/realtime.events';
@Injectable()
export class MessagingBridge implements OnModuleInit, OnModuleDestroy {
  private subscription?: ReturnType<typeof subscribeMessagingUpdates>;
  constructor(private readonly events: RealtimeEvents) {}
  onModuleInit() {
    if (process.env.REDIS_URL)
      this.subscription = subscribeMessagingUpdates(
        process.env.REDIS_URL,
        (notice) =>
          this.events.publish({ type: 'message.status_updated', ...notice }),
      );
  }
  async onModuleDestroy() {
    await this.subscription?.close();
  }
}
