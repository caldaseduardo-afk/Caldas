import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { ProviderRepository } from './provider.repository';
import { ProviderServiceRepository } from './provider-service.repository';
import { ProviderUnitRepository } from './provider-unit.repository';
import { EligibleProvidersRepository } from './eligible-providers.repository';
import { ProvidersService } from './providers.service';
import { ProviderServicesService } from './provider-services.service';
import { ProviderUnitsService } from './provider-units.service';
import { ProvidersController } from './providers.controller';
import { ProviderServicesController } from './provider-services.controller';
import { ProviderUnitsController } from './provider-units.controller';
import { EligibleProvidersController } from './eligible-providers.controller';
@Module({
  imports: [DatabaseModule, PermissionsModule],
  providers: [
    ProviderRepository,
    ProviderServiceRepository,
    ProviderUnitRepository,
    EligibleProvidersRepository,
    ProvidersService,
    ProviderServicesService,
    ProviderUnitsService,
  ],
  controllers: [
    ProvidersController,
    ProviderServicesController,
    ProviderUnitsController,
    EligibleProvidersController,
  ],
})
export class ProvidersModule {}
