import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { PatientWrite } from './patient-access';
import { PatientRepository } from './patient.repository';
import { RelationshipRepository } from './relationship.repository';
import { PatientContactAccessRepository } from './patient-contact-access.repository';
import { PatientsService } from './patients.service';
import { RelationshipsService } from './relationships.service';
import { PatientAccessService } from './patient-access.service';
import { PatientsController } from './patients.controller';
import { RelationshipsController } from './relationships.controller';
import { PatientContactAccessController } from './patient-contact-access.controller';
@Module({
  imports: [DatabaseModule, PermissionsModule],
  providers: [
    PatientWrite,
    PatientRepository,
    RelationshipRepository,
    PatientContactAccessRepository,
    PatientsService,
    RelationshipsService,
    PatientAccessService,
  ],
  controllers: [
    PatientsController,
    RelationshipsController,
    PatientContactAccessController,
  ],
  exports: [PatientAccessService],
})
export class PatientsModule {}
