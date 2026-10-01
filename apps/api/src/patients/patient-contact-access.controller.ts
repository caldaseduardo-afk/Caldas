import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { RequirePermissions } from '../permissions/permission.decorator';
import { PatientAccessService } from './patient-access.service';
import { RelationshipsService } from './relationships.service';
@Controller('contacts/:contactId')
@RequirePermissions('patient.view', 'contact.view')
export class PatientContactAccessController {
  constructor(
    private readonly access: PatientAccessService,
    private readonly links: RelationshipsService,
  ) {}
  @Get('patient-links') list(
    @Param('contactId', new ParseUUIDPipe()) id: string,
  ) {
    return this.links.listByContact(id);
  }
  @Get('patients/:patientId') find(
    @Param('contactId', new ParseUUIDPipe()) contactId: string,
    @Param('patientId', new ParseUUIDPipe()) patientId: string,
  ) {
    return this.access.forContact(contactId, patientId);
  }
}
