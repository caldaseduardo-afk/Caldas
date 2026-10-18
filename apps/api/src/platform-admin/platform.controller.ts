import { Body, Controller, Get, Param, Patch, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthRequest } from '../auth/auth.guard';
import { PlatformOnly } from './platform.decorator';
import { PlatformService } from './platform.service';
import { platformQuery, platformTenantId } from './platform.dto';
import { parseSubscriptionChange } from '../plans/plans.dto';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
@PlatformOnly()
@Controller('super-admin')
export class PlatformController {
  constructor(private readonly service: PlatformService) {}
  @Get('overview')
  @RateLimit(60)
  overview(
    @Req() req: AuthRequest,
    @Query() query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.service.read(req.platform!, platformQuery(query));
  }
  @Get('tenants/:id')
  @RateLimit(60)
  tenant(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.service.read(
      req.platform!,
      platformQuery(query),
      platformTenantId(id),
    );
  }
  @Patch('tenants/:id/subscription')
  changeSubscription(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.service.changeSubscription(
      req.platform!,
      platformTenantId(id),
      parseSubscriptionChange(body),
    );
  }
  @Get('health')
  health(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.service.health();
  }
}
