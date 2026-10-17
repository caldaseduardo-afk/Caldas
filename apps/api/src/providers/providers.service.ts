import { Injectable } from '@nestjs/common';
import { AuthorizationService } from '../permissions/authorization.service';
import { ProviderRepository } from './provider.repository';
import {
  createProviderDto,
  updateProviderDto,
  providerFilter,
} from './provider.dto';
import { providerPermissions } from './provider-access';
@Injectable()
export class ProvidersService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly repository: ProviderRepository,
  ) {}
  async list(query: unknown) {
    await this.authorization.requirePermissions(...providerPermissions);
    return this.repository.list(providerFilter(query));
  }
  async find(id: string) {
    await this.authorization.requirePermissions(...providerPermissions);
    return this.repository.find(id);
  }
  async create(body: unknown) {
    await this.authorization.requirePermissions(...providerPermissions);
    return this.repository.create(createProviderDto(body));
  }
  async update(id: string, body: unknown) {
    await this.authorization.requirePermissions(...providerPermissions);
    return this.repository.update(id, updateProviderDto(body));
  }
}
