import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RequirePermissions } from '../permissions/permission.decorator';
import { PlansService } from './plans.service';

@Controller('plans')
@RequirePermissions('billing.view')
export class PlansController {
  constructor(private readonly service: PlansService) {}

  @Get('current')
  current(@Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return this.service.current();
  }

  @Get('catalog')
  catalog(@Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return this.service.catalog();
  }
}
