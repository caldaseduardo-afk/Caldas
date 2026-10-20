import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PlatformAuthService } from './platform-auth.service';
import { RealtimeEventsModule } from '../realtime/realtime.events';
@Module({
  imports: [DatabaseModule, RealtimeEventsModule],
  providers: [PlatformAuthService],
  exports: [PlatformAuthService],
})
export class PlatformSecurityModule {}
