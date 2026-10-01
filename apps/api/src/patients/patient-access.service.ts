import { Injectable } from '@nestjs/common';
import { AuthorizationService } from '../permissions/authorization.service';
import { PatientContactAccessRepository } from './patient-contact-access.repository';

// Futuro active_patient_id deve passar por esta validação em cada operação.
// Isto não autentica o contato: a identidade do canal será responsabilidade da integração futura.
@Injectable()
export class PatientAccessService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly patients: PatientContactAccessRepository,
  ) {}
  async forContact(contactId: string, patientId: string) {
    await this.authorization.requirePermissions('patient.view', 'contact.view');
    return this.patients.find(contactId, patientId);
  }
}
