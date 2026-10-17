import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { RealtimeEventsModule } from './realtime.events';
import { RealtimeGateway } from './realtime.gateway';
@Module({
  imports: [AuthModule, DatabaseModule, RealtimeEventsModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
