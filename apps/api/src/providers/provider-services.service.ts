import { Injectable } from '@nestjs/common';
import { AuthorizationService } from '../permissions/authorization.service';
import { ProviderServiceRepository } from './provider-service.repository';
import {
  createProviderServiceDto,
  updateProviderServiceDto,
  providerFilter,
} from './provider.dto';
import { providerServicePermissions } from './provider-access';
import { EligibleProvidersRepository } from './eligible-providers.repository';
@Injectable()
export class ProviderServicesService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly repository: ProviderServiceRepository,
    private readonly eligible: EligibleProvidersRepository,
  ) {}
  async list(providerId: string, query: unknown) {
    await this.authorization.requirePermissions(...providerServicePermissions);
    return this.repository.list(providerId, providerFilter(query));
  }
  async create(providerId: string, body: unknown) {
    await this.authorization.requirePermissions(...providerServicePermissions);
    return this.repository.create(providerId, createProviderServiceDto(body));
  }
  async update(providerId: string, id: string, body: unknown) {
    await this.authorization.requirePermissions(...providerServicePermissions);
    return this.repository.update(
      providerId,
      id,
      updateProviderServiceDto(body),
    );
  }
  async listEligible(serviceId: string) {
    await this.authorization.requirePermissions(...providerServicePermissions);
    return this.eligible.list(serviceId);
  }
}
