import { Module } from '@nestjs/common';
import { AI_PROVIDER } from '@atendente/domain';
import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { AIConfigResolver } from './ai.config';
import { OpenAIProvider } from './openai.provider';
import { AIService } from './ai.service';
import { AIUsageRepository } from './ai-usage.repository';
@Module({
  imports: [DatabaseModule, PermissionsModule],
  providers: [
    AIConfigResolver,
    AIUsageRepository,
    AIService,
    {
      provide: AI_PROVIDER,
      inject: [AIConfigResolver],
      useFactory: (config: AIConfigResolver) =>
        new OpenAIProvider(() => config.resolve()),
    },
  ],
  exports: [AIService, AIConfigResolver],
})
export class AIModule {}
