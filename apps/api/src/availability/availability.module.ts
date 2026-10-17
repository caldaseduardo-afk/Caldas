import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { AvailabilityRuleRepository } from './availability-rule.repository';
import { ScheduleExceptionRepository } from './schedule-exception.repository';
import { AvailabilityRepository } from './availability.repository';
import { AvailabilityRulesService } from './availability-rules.service';
import { ScheduleExceptionsService } from './schedule-exceptions.service';
import { AvailabilityService } from './availability.service';
import { AvailabilityRulesController } from './availability-rules.controller';
import { ScheduleExceptionsController } from './schedule-exceptions.controller';
import { AvailabilityController } from './availability.controller';
@Module({
  imports: [DatabaseModule, PermissionsModule],
  providers: [
    AvailabilityRuleRepository,
    ScheduleExceptionRepository,
    AvailabilityRepository,
    AvailabilityRulesService,
    ScheduleExceptionsService,
    AvailabilityService,
  ],
  controllers: [
    AvailabilityRulesController,
    ScheduleExceptionsController,
    AvailabilityController,
  ],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
