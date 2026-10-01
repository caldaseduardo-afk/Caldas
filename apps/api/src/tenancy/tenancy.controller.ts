import {
  IdentityOnly,
  RequirePermissions,
} from '../permissions/permission.decorator';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { TenantOptional } from './tenant.guard';
import { TenancyService } from './tenancy.service';

@Controller('tenancy')
export class TenancyController {
  constructor(private readonly tenancy: TenancyService) {}
  @IdentityOnly()
  @TenantOptional()
  @Get('tenants')
  list() {
    return this.tenancy.listAvailable();
  }

  @IdentityOnly()
  @TenantOptional()
  @Post('active')
  @HttpCode(200)
  select(@Body() body: unknown) {
    return this.tenancy.select(body);
  }

  @RequirePermissions('tenant.view')
  @Get('active')
  current() {
    return this.tenancy.current();
  }

  @RequirePermissions('unit.view')
  @Get('units')
  units() {
    return this.tenancy.listUnits();
  }

  @RequirePermissions('unit.view')
  @Get('units/:id')
  unit(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.tenancy.findUnit(id);
  }
}
