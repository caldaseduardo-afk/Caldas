import { Injectable } from '@nestjs/common';
import { AuthorizationService } from '../permissions/authorization.service';
import { PatientRepository } from './patient.repository';
import { createPatientDto, updatePatientDto } from './patient.dto';
@Injectable()
export class PatientsService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly patients: PatientRepository,
  ) {}
  async list() {
    await this.authorization.requirePermissions('patient.view');
    return this.patients.list();
  }
  async find(id: string) {
    await this.authorization.requirePermissions('patient.view');
    return this.patients.find(id);
  }
  async create(body: unknown) {
    await this.authorization.requirePermissions('patient.edit');
    return this.patients.create(createPatientDto(body));
  }
  async update(id: string, body: unknown) {
    await this.authorization.requirePermissions('patient.edit');
    return this.patients.update(id, updatePatientDto(body));
  }
}
