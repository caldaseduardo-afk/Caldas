import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { PlansController } from './plans.controller';
import { PlansRepository } from './plans.repository';
import { PlansService } from './plans.service';

@Module({
  imports: [DatabaseModule, PermissionsModule],
  controllers: [PlansController],
  providers: [PlansRepository, PlansService],
  exports: [PlansRepository],
})
export class PlansModule {}
