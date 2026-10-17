import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { RealtimeEventsModule } from '../realtime/realtime.events';
import { HumanSlaController } from './human-sla.controller';
import { HumanSlaService } from './human-sla.service';
import { HumanSlaRepository } from './human-sla.repository';
import { HumanSlaBridge } from './human-sla.bridge';
@Module({
  imports: [DatabaseModule, PermissionsModule, RealtimeEventsModule],
  controllers: [HumanSlaController],
  providers: [HumanSlaService, HumanSlaRepository, HumanSlaBridge],
})
export class HumanSlaModule {}
