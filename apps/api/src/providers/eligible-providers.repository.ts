import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../auth/database.service';
import { AuthorizationService } from '../permissions/authorization.service';
import {
  providerWhere,
  providerServicePermissions,
  providerSummary,
} from './provider-access';
@Injectable()
export class EligibleProvidersRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}
  async list(serviceId: string) {
    const scope = await this.authorization.requirePermissions(
      ...providerServicePermissions,
    );
    const where = providerWhere(scope, providerServicePermissions);
    // Uma única consulta relacional valida tenant e todos os indicadores cadastrais.
    const service = await this.database.client.service.findFirst({
      where: { id: serviceId, ...where },
      select: {
        providers: {
          where: {
            ...where,
            active: true,
            service: { ...where, active: true },
            provider: { ...where, active: true },
          },
          select: { provider: { select: providerSummary } },
          orderBy: { providerId: 'asc' },
        },
      },
    });
    if (!service) throw new NotFoundException('Recurso não encontrado.');
    return service.providers.map((link) => link.provider);
  }
}
