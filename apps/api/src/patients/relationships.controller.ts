import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { RequirePermissions } from '../permissions/permission.decorator';
import { RelationshipsService } from './relationships.service';
@Controller('patients/:patientId/relationships')
export class RelationshipsController {
  constructor(private readonly links: RelationshipsService) {}
  @Get() @RequirePermissions('patient.view', 'contact.view') list(
    @Param('patientId', new ParseUUIDPipe()) patientId: string,
  ) {
    return this.links.listByPatient(patientId);
  }
  @Post() @RequirePermissions('patient.edit', 'contact.view') create(
    @Param('patientId', new ParseUUIDPipe()) patientId: string,
    @Body() body: unknown,
  ) {
    return this.links.create(patientId, body);
  }
  @Patch(':id') @RequirePermissions('patient.edit', 'contact.view') update(
    @Param('patientId', new ParseUUIDPipe()) patientId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.links.update(patientId, id, body);
  }
  @Post(':id/revoke')
  @HttpCode(200)
  @RequirePermissions('patient.edit', 'contact.view')
  revoke(
    @Param('patientId', new ParseUUIDPipe()) patientId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.links.revoke(patientId, id);
  }
}
