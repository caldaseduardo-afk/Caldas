import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  createConversationEngineQueue,
  enqueueConversationEngineRun,
  type ConversationEngineJob,
} from '@atendente/database';

@Injectable()
export class ConversationEngineEnqueuer implements OnModuleDestroy {
  private readonly queue =
    process.env.REDIS_URL && process.env.CONVERSATION_ENGINE_ENABLED === 'true'
      ? createConversationEngineQueue(process.env.REDIS_URL)
      : undefined;

  async enqueue(job: ConversationEngineJob) {
    if (!this.queue) return false;
    try {
      await enqueueConversationEngineRun(this.queue, job);
      return true;
    } catch {
      // PostgreSQL keeps the PENDING run; the periodic dispatcher will retry.
      return false;
    }
  }

  async onModuleDestroy() {
    await this.queue?.close();
  }
}
