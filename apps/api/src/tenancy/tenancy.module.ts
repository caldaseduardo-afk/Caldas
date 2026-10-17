import { RealtimeEventsModule } from '../realtime/realtime.events';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TenantContextModule } from './tenant-context.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { TenantRepository } from './tenant.repository';
import { UnitsModule } from '../units/units.module';
import { TenancyService } from './tenancy.service';
import { TenancyController } from './tenancy.controller';

@Module({
  imports: [
    RealtimeEventsModule,
    DatabaseModule,
    TenantContextModule,
    PermissionsModule,
    UnitsModule,
  ],
  controllers: [TenancyController],
  providers: [TenantRepository, TenancyService],
  exports: [TenantContextModule],
})
export class TenancyModule {}
