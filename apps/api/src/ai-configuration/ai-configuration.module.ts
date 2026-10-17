import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { DatabaseModule } from '../database/database.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { ToolsModule } from '../tools/tools.module';
import { AIConfigurationController } from './ai-configuration.controller';
import { AIConfigurationRepository } from './ai-configuration.repository';
import { AIConfigurationService } from './ai-configuration.service';
import { AIConfigurationSimulationService } from './ai-configuration.simulation';
import { AIPromptComposer } from './ai-prompt-composer.service';
@Module({
  imports: [
    DatabaseModule,
    PermissionsModule,
    AIModule,
    ToolsModule,
    KnowledgeModule,
  ],
  controllers: [AIConfigurationController],
  providers: [
    AIConfigurationRepository,
    AIConfigurationService,
    AIConfigurationSimulationService,
    AIPromptComposer,
  ],
  exports: [AIConfigurationService, AIPromptComposer],
})
export class AIConfigurationModule {}
