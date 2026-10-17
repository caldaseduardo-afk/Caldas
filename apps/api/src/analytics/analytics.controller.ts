import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermissions } from '../permissions/permission.decorator';
import { AnalyticsService } from './analytics.service';
@Controller('analytics/dashboard')
@RequirePermissions('analytics.view')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}
  @Get() dashboard(@Query() query: unknown) {
    return this.service.dashboard(query);
  }
  @Get('options') options(@Query() query: unknown) {
    return this.service.options(query);
  }
}
