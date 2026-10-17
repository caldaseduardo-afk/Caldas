import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { HoldConfig } from './hold.config';
import { HoldRepository } from './hold.repository';
import { HoldsService } from './holds.service';
import { HoldsController } from './holds.controller';
@Module({
  imports: [DatabaseModule, PermissionsModule],
  providers: [HoldConfig, HoldRepository, HoldsService],
  exports: [HoldsService],
  controllers: [HoldsController],
})
export class HoldsModule {}
