import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { SpecialtyRepository } from './specialty.repository';
import { ServiceRepository } from './service.repository';
import { SpecialtiesService } from './specialties.service';
import { ServicesService } from './services.service';
import { SpecialtiesController } from './specialties.controller';
import { ServicesController } from './services.controller';
@Module({
  imports: [DatabaseModule, PermissionsModule],
  providers: [
    SpecialtyRepository,
    ServiceRepository,
    SpecialtiesService,
    ServicesService,
  ],
  controllers: [SpecialtiesController, ServicesController],
})
export class CatalogModule {}
