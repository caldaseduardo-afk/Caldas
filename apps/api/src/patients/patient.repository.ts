import { recordAudit } from '@atendente/database';
import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../auth/database.service';
import { AuthorizationService } from '../permissions/authorization.service';
import {
  PatientWrite,
  patientWhere,
  patientDetails,
  patientSummary,
  presentPatient,
} from './patient-access';
import type { PatientDto } from './patient.dto';

@Injectable()
export class PatientRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly write: PatientWrite,
  ) {}
  async list() {
    const scope = await this.authorization.requirePermissions('patient.view');
    return (
      await this.database.client.patient.findMany({
        where: patientWhere(scope, ['patient.view']),
        select: patientSummary,
        orderBy: { id: 'asc' },
      })
    ).map(presentPatient);
  }
  async find(id: string) {
    const scope = await this.authorization.requirePermissions('patient.view');
    const patient = await this.database.client.patient.findFirst({
      where: { id, ...patientWhere(scope, ['patient.view']) },
      select: patientDetails,
    });
    if (!patient) throw new NotFoundException('Paciente não encontrado.');
    return presentPatient(patient);
  }
  create(dto: PatientDto) {
    return this.write.run(['patient.edit'], async (tx, scope) => {
      const patient = await tx.patient.create({
        data: {
          tenantId: scope.tenantId,
          name: dto.name,
          birthDate: dto.birthDate,
          document: dto.document,
          healthPlan: dto.healthPlan,
          paymentPreference: dto.paymentPreference,
          notes: dto.notes,
        },
        select: patientDetails,
      });
      await recordAudit(tx, {
        data: {
          type: 'PATIENT_CREATED',
          userId: scope.userId,
          tenantId: scope.tenantId,
          resourceId: patient.id,
          changes: { fields: Object.keys(dto) },
        },
      });
      return presentPatient(patient);
    });
  }
  update(id: string, dto: Partial<PatientDto>) {
    return this.write.run(['patient.edit'], async (tx, scope) => {
      const [patient] = await tx.patient.updateManyAndReturn({
        where: { id, ...patientWhere(scope, ['patient.edit']) },
        data: {
          name: dto.name,
          birthDate: dto.birthDate,
          document: dto.document,
          healthPlan: dto.healthPlan,
          paymentPreference: dto.paymentPreference,
          notes: dto.notes,
        },
        select: patientDetails,
      });
      if (!patient) throw new NotFoundException('Paciente não encontrado.');
      await recordAudit(tx, {
        data: {
          type: 'PATIENT_UPDATED',
          userId: scope.userId,
          tenantId: scope.tenantId,
          resourceId: patient.id,
          changes: { fields: Object.keys(dto) },
        },
      });
      return presentPatient(patient);
    });
  }
}
