import { Body, Controller, Get, Put } from '@nestjs/common';
import { RequirePermissions } from '../permissions/permission.decorator';
import { integrationSettingsDto } from './integration-settings.dto';
import { IntegrationSettingsService } from './integration-settings.service';

@Controller('settings/integrations')
export class IntegrationSettingsController {
  constructor(private readonly service: IntegrationSettingsService) {}

  @Get() @RequirePermissions('settings.view') get() {
    return this.service.get();
  }

  @Put() @RequirePermissions('settings.manage') configure(
    @Body() body: unknown,
  ) {
    return this.service.configure(integrationSettingsDto(body));
  }
}
