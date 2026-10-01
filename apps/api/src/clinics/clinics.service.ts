import { Injectable } from '@nestjs/common';
import { AuthorizationService } from '../permissions/authorization.service';
import { ClinicRepository } from './clinic.repository';
import { updateClinicDto } from './clinic.dto';

@Injectable()
export class ClinicsService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly clinics: ClinicRepository,
  ) {}
  async list() {
    await this.authorization.requirePermissions('tenant.view');
    return this.clinics.list();
  }
  async find(id: string) {
    await this.authorization.requirePermissions('tenant.view');
    return this.clinics.find(id);
  }
  async update(id: string, body: unknown) {
    await this.authorization.requirePermissions('settings.manage');
    return this.clinics.update(id, updateClinicDto(body));
  }
  async deactivate(id: string) {
    await this.authorization.requirePermissions('settings.manage');
    return this.clinics.update(id, { status: 'INACTIVE' });
  }
}
