import {
  Injectable,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { subscribeHumanSlaUpdates } from '@atendente/database';
import { RealtimeEvents } from '../realtime/realtime.events';
@Injectable()
export class HumanSlaBridge implements OnModuleInit, OnModuleDestroy {
  private subscription?: ReturnType<typeof subscribeHumanSlaUpdates>;
  constructor(private readonly events: RealtimeEvents) {}
  onModuleInit() {
    if (process.env.REDIS_URL)
      this.subscription = subscribeHumanSlaUpdates(
        process.env.REDIS_URL,
        (notice) =>
          this.events.publish({ type: 'conversation.sla_updated', ...notice }),
      );
  }
  async onModuleDestroy() {
    await this.subscription?.close();
  }
}
