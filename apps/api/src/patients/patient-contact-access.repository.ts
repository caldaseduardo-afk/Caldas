import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../auth/database.service';
import { AuthorizationService } from '../permissions/authorization.service';
import { patientWhere, patientSummary, presentPatient } from './patient-access';

@Injectable()
export class PatientContactAccessRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}
  async find(contactId: string, patientId: string) {
    const permissions = ['patient.view', 'contact.view'] as const;
    const scope = await this.authorization.requirePermissions(...permissions);
    // A autorização do vínculo faz parte da consulta que lê o paciente.
    const patient = await this.database.client.patient.findFirst({
      where: {
        id: patientId,
        ...patientWhere(scope, [...permissions]),
        contacts: {
          some: {
            tenantId: scope.tenantId,
            contactId,
            active: true,
            relationshipStatus: 'VERIFIED',
            authorizationLevel: 'FULL',
            contact: { tenantId: scope.tenantId, status: 'ACTIVE' },
          },
        },
      },
      select: patientSummary,
    });
    if (!patient)
      throw new NotFoundException('Paciente indisponível para este contato.');
    return presentPatient(patient);
  }
}
