import { ToolConfig } from './tool.config';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { HoldsModule } from '../holds/holds.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { CatalogModule } from '../catalog/catalog.module';
import { SchedulingService } from '../scheduling/scheduling.service';
import { SchedulingRepository } from '../scheduling/scheduling.repository';
import { ToolContextRepository } from './tool-context.repository';
import { ToolExecutionRepository } from './tool-execution.repository';
import { ToolRegistry } from './tool.schemas';
import { ToolHandlers } from './tool.handlers';
import { ToolGateway } from './tool-gateway.service';
import { KnowledgeModule } from '../knowledge/knowledge.module';
@Module({
  imports: [
    DatabaseModule,
    PermissionsModule,
    HoldsModule,
    AppointmentsModule,
    ConversationsModule,
    CatalogModule,
    KnowledgeModule,
  ],
  providers: [
    ToolConfig,
    SchedulingService,
    SchedulingRepository,
    ToolContextRepository,
    ToolExecutionRepository,
    ToolRegistry,
    ToolHandlers,
    ToolGateway,
  ],
  exports: [ToolGateway],
})
export class ToolsModule {}
