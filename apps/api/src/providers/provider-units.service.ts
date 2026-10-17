import { Injectable } from '@nestjs/common';
import { AuthorizationService } from '../permissions/authorization.service';
import { ProviderUnitRepository } from './provider-unit.repository';
import {
  createProviderUnitDto,
  updateProviderUnitDto,
  providerFilter,
} from './provider.dto';
import { providerUnitPermissions } from './provider-access';

@Injectable()
export class ProviderUnitsService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly repository: ProviderUnitRepository,
  ) {}
  async list(providerId: string, query: unknown) {
    await this.authorization.requirePermissions(...providerUnitPermissions);
    return this.repository.list(providerId, providerFilter(query));
  }
  async create(providerId: string, body: unknown) {
    await this.authorization.requirePermissions(...providerUnitPermissions);
    return this.repository.create(providerId, createProviderUnitDto(body));
  }
  async update(providerId: string, id: string, body: unknown) {
    await this.authorization.requirePermissions(...providerUnitPermissions);
    return this.repository.update(providerId, id, updateProviderUnitDto(body));
  }
}
