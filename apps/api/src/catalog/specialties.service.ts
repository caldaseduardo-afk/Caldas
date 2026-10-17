import { Injectable } from '@nestjs/common';
import { AuthorizationService } from '../permissions/authorization.service';
import { SpecialtyRepository } from './specialty.repository';
import {
  createSpecialtyDto,
  updateSpecialtyDto,
  catalogFilter,
} from './catalog.dto';
@Injectable()
export class SpecialtiesService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly repository: SpecialtyRepository,
  ) {}
  async forAttendance() {
    await this.authorization.requirePermissions('appointment.view');
    return this.repository.forAttendance();
  }
  async list(query: unknown) {
    await this.authorization.requirePermissions('service.manage');
    return this.repository.list(catalogFilter(query, false));
  }
  async find(id: string) {
    await this.authorization.requirePermissions('service.manage');
    return this.repository.find(id);
  }
  async create(body: unknown) {
    await this.authorization.requirePermissions('service.manage');
    return this.repository.create(createSpecialtyDto(body));
  }
  async update(id: string, body: unknown) {
    await this.authorization.requirePermissions('service.manage');
    return this.repository.update(id, updateSpecialtyDto(body));
  }
}
