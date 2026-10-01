import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { ClinicRepository } from './clinic.repository';
import { ClinicsService } from './clinics.service';
import { ClinicsController } from './clinics.controller';
@Module({
  imports: [DatabaseModule, PermissionsModule],
  providers: [ClinicRepository, ClinicsService],
  controllers: [ClinicsController],
})
export class ClinicsModule {}
