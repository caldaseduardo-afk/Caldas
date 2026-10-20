import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { IntegrationSettingsController } from './integration-settings.controller';
import { IntegrationSettingsService } from './integration-settings.service';

@Module({
  imports: [DatabaseModule, PermissionsModule],
  controllers: [IntegrationSettingsController],
  providers: [IntegrationSettingsService],
})
export class IntegrationSettingsModule {}
