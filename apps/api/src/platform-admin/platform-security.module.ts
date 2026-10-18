import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PlatformAuthService } from './platform-auth.service';
@Module({
  imports: [DatabaseModule],
  providers: [PlatformAuthService],
  exports: [PlatformAuthService],
})
export class PlatformSecurityModule {}
