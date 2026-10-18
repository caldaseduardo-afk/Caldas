import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermissions } from '../permissions/permission.decorator';
import { AnalyticsService } from './analytics.service';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
@Controller('analytics/dashboard')
@RequirePermissions('analytics.view')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}
  @Get() @RateLimit(60) dashboard(@Query() query: unknown) {
    return this.service.dashboard(query);
  }
  @Get('options') @RateLimit(60) options(@Query() query: unknown) {
    return this.service.options(query);
  }
}
