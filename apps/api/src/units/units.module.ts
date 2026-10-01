import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { UnitRepository } from './unit.repository';
import { UnitsService } from './units.service';
import { UnitsController } from './units.controller';
@Module({
  imports: [DatabaseModule, PermissionsModule],
  providers: [UnitRepository, UnitsService],
  controllers: [UnitsController],
  exports: [UnitRepository],
})
export class UnitsModule {}
