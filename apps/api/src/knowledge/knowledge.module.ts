import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeRepository } from './knowledge.repository';
import { KnowledgeRetrieverService } from './knowledge-retriever.service';
import { KnowledgeService } from './knowledge.service';
import { KNOWLEDGE_RETRIEVER } from './knowledge.types';
@Module({
  imports: [DatabaseModule, PermissionsModule],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeRepository,
    KnowledgeRetrieverService,
    { provide: KNOWLEDGE_RETRIEVER, useExisting: KnowledgeRetrieverService },
    KnowledgeService,
  ],
  exports: [KnowledgeService, KNOWLEDGE_RETRIEVER],
})
export class KnowledgeModule {}
