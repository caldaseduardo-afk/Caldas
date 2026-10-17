import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { DatabaseModule } from '../database/database.module';
import { RealtimeEventsModule } from '../realtime/realtime.events';
import { ToolsModule } from '../tools/tools.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { ConversationEngineConfig } from './conversation-engine.config';
import { ConversationEngineRepository } from './conversation-engine.repository';
import { ConversationEngineRuntime } from './conversation-engine.runtime';
import { ConversationEngineService } from './conversation-engine.service';
import { SchedulingWorkflowCoordinator } from '../scheduling-workflow/scheduling-workflow.coordinator';
import { SchedulingWorkflowRepository } from '../scheduling-workflow/scheduling-workflow.repository';
import { AIConfigurationModule } from '../ai-configuration/ai-configuration.module';

@Module({
  imports: [
    DatabaseModule,
    PermissionsModule,
    RealtimeEventsModule,
    AIModule,
    ToolsModule,
    AIConfigurationModule,
  ],
  providers: [
    ConversationEngineConfig,
    ConversationEngineRepository,
    ConversationEngineService,
    ConversationEngineRuntime,
    SchedulingWorkflowRepository,
    SchedulingWorkflowCoordinator,
  ],
  exports: [ConversationEngineService],
})
export class ConversationEngineModule {}
