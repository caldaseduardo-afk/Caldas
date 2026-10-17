import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { RequirePermissions } from '../permissions/permission.decorator';
import { CalendarIntegrationsService } from './calendar-integrations.service';

@Controller('settings/calendar')
export class CalendarIntegrationsController {
  constructor(private readonly service: CalendarIntegrationsService) {}
  @Get() @RequirePermissions('settings.view') get() {
    return this.service.get();
  }
  @Put() @RequirePermissions('settings.manage') configure(
    @Body() body: unknown,
  ) {
    return this.service.configure(body);
  }
  @Post('test') @HttpCode(200) @RequirePermissions('settings.manage') test() {
    return this.service.testConnection();
  }
}
