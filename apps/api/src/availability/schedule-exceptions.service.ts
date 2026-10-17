import { Injectable } from '@nestjs/common';
import { AuthorizationService } from '../permissions/authorization.service';
import { ScheduleExceptionRepository } from './schedule-exception.repository';
import { availabilityPermissions } from './availability-access';
import {
  createExceptionDto,
  updateExceptionDto,
  availabilityFilter,
} from './availability.dto';
@Injectable()
export class ScheduleExceptionsService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly repository: ScheduleExceptionRepository,
  ) {}
  async list(query: unknown) {
    await this.authorization.requirePermissions(...availabilityPermissions);
    return this.repository.list(availabilityFilter(query, true));
  }
  async find(id: string) {
    await this.authorization.requirePermissions(...availabilityPermissions);
    return this.repository.find(id);
  }
  async create(body: unknown) {
    await this.authorization.requirePermissions(...availabilityPermissions);
    return this.repository.create(createExceptionDto(body));
  }
  async update(id: string, body: unknown) {
    await this.authorization.requirePermissions(...availabilityPermissions);
    return this.repository.update(id, updateExceptionDto(body));
  }
}
