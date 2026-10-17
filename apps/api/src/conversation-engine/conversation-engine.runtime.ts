import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import {
  createConversationEngineQueue,
  createConversationEngineWorker,
  dispatchConversationEngineRuns,
  subscribeConversationEngineUpdates,
} from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import { RealtimeEvents } from '../realtime/realtime.events';
import { ConversationEngineService } from './conversation-engine.service';
import { SchedulingWorkflowRepository } from '../scheduling-workflow/scheduling-workflow.repository';

@Injectable()
export class ConversationEngineRuntime
  implements OnModuleInit, OnModuleDestroy
{
  private queue?: ReturnType<typeof createConversationEngineQueue>;
  private worker?: ReturnType<typeof createConversationEngineWorker>;
  private events?: ReturnType<typeof subscribeConversationEngineUpdates>;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly database: DatabaseService,
    private readonly realtime: RealtimeEvents,
    private readonly modules: ModuleRef,
    private readonly scheduling: SchedulingWorkflowRepository,
  ) {}

  onModuleInit() {
    const redis = process.env.REDIS_URL;
    if (!redis || process.env.CONVERSATION_ENGINE_ENABLED !== 'true') return;
    this.queue = createConversationEngineQueue(redis);
    this.worker = createConversationEngineWorker(redis, async (job) => {
      const contextId = ContextIdFactory.create();
      this.modules.registerRequestByContextId(Object.freeze({}), contextId);
      const service = await this.modules.resolve(
        ConversationEngineService,
        contextId,
        { strict: false },
      );
      return service.process(job);
    });
    this.events = subscribeConversationEngineUpdates(redis, (notice) =>
      this.realtime.publish(notice),
    );
    const dispatch = () =>
      Promise.all([
        dispatchConversationEngineRuns(this.database.client, this.queue!),
        this.scheduling.expireDue(),
      ]).catch(() => console.error('Falha ao despachar conversation engine.'));
    void dispatch();
    this.timer = setInterval(dispatch, 5000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
    await this.events?.close();
    await this.queue?.close();
  }
}
