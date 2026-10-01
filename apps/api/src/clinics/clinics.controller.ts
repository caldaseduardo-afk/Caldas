import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { RequirePermissions } from '../permissions/permission.decorator';
import { ClinicsService } from './clinics.service';

@Controller('clinics')
export class ClinicsController {
  constructor(private readonly clinics: ClinicsService) {}
  @Get() @RequirePermissions('tenant.view') list() {
    return this.clinics.list();
  }
  @Get(':id') @RequirePermissions('tenant.view') find(
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.clinics.find(id);
  }
  @Patch(':id') @RequirePermissions('settings.manage') update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.clinics.update(id, body);
  }
  @Delete(':id') @RequirePermissions('settings.manage') deactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.clinics.deactivate(id);
  }
}
