import { Injectable } from '@nestjs/common';
import { AuthorizationService } from '../permissions/authorization.service';
import { ServiceRepository } from './service.repository';
import {
  createServiceDto,
  updateServiceDto,
  catalogFilter,
} from './catalog.dto';
@Injectable()
export class ServicesService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly repository: ServiceRepository,
  ) {}
  async forAttendance(specialtyId?: string) {
    await this.authorization.requirePermissions('appointment.view');
    return this.repository.forAttendance(specialtyId);
  }
  async list(query: unknown) {
    await this.authorization.requirePermissions('service.manage');
    return this.repository.list(catalogFilter(query, true));
  }
  async find(id: string) {
    await this.authorization.requirePermissions('service.manage');
    return this.repository.find(id);
  }
  async create(body: unknown) {
    await this.authorization.requirePermissions('service.manage');
    return this.repository.create(createServiceDto(body));
  }
  async update(id: string, body: unknown) {
    await this.authorization.requirePermissions('service.manage');
    return this.repository.update(id, updateServiceDto(body));
  }
}
