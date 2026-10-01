import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { RequirePermissions } from '../permissions/permission.decorator';
import { UnitsService } from './units.service';

@Controller('units')
export class UnitsController {
  constructor(private readonly units: UnitsService) {}
  @Get() @RequirePermissions('unit.view') list() {
    return this.units.list();
  }
  @Get(':id') @RequirePermissions('unit.view') find(
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.units.find(id);
  }
  @Post() @RequirePermissions('settings.manage') create(@Body() body: unknown) {
    return this.units.create(body);
  }
  @Patch(':id') @RequirePermissions('settings.manage') update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.units.update(id, body);
  }
  @Delete(':id') @RequirePermissions('settings.manage') deactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.units.deactivate(id);
  }
}
