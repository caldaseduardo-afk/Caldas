import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { RequirePermissions } from '../permissions/permission.decorator';
import { PatientsService } from './patients.service';
@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}
  @Get() @RequirePermissions('patient.view') list() {
    return this.patients.list();
  }
  @Get(':id') @RequirePermissions('patient.view') find(
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.patients.find(id);
  }
  @Post() @RequirePermissions('patient.edit') create(@Body() body: unknown) {
    return this.patients.create(body);
  }
  @Patch(':id') @RequirePermissions('patient.edit') update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.patients.update(id, body);
  }
}
