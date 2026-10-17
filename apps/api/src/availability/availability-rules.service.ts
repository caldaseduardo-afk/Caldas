import { Injectable } from '@nestjs/common';
import { AuthorizationService } from '../permissions/authorization.service';
import { AvailabilityRuleRepository } from './availability-rule.repository';
import { availabilityPermissions } from './availability-access';
import {
  createRuleDto,
  updateRuleDto,
  availabilityFilter,
} from './availability.dto';
@Injectable()
export class AvailabilityRulesService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly repository: AvailabilityRuleRepository,
  ) {}
  async list(query: unknown) {
    await this.authorization.requirePermissions(...availabilityPermissions);
    return this.repository.list(availabilityFilter(query, false));
  }
  async find(id: string) {
    await this.authorization.requirePermissions(...availabilityPermissions);
    return this.repository.find(id);
  }
  async create(body: unknown) {
    await this.authorization.requirePermissions(...availabilityPermissions);
    return this.repository.create(createRuleDto(body));
  }
  async update(id: string, body: unknown) {
    await this.authorization.requirePermissions(...availabilityPermissions);
    return this.repository.update(id, updateRuleDto(body));
  }
}
