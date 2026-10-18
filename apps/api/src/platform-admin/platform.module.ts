import { PlatformService } from './platform.service';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PlatformSecurityModule } from './platform-security.module';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformController } from './platform.controller';
import { PlatformRepository } from './platform.repository';
@Module({
  imports: [DatabaseModule, PlatformSecurityModule],
  controllers: [PlatformAuthController, PlatformController],
  providers: [PlatformRepository, PlatformService],
})
export class PlatformModule {}
