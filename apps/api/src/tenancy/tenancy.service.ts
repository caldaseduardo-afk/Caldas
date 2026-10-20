import { AuthorizationService } from '../permissions/authorization.service';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { TenantContext } from './tenant.context';
import { TenantRepository } from './tenant.repository';
import { UnitRepository } from '../units/unit.repository';

export function tenantSelection(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('Dados inválidos.');
  const input = body as Record<string, unknown>;
  if (
    Object.keys(input).length !== 1 ||
    typeof input.tenantId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      input.tenantId,
    )
  )
    throw new BadRequestException('Dados inválidos.');
  return input.tenantId;
}

@Injectable()
export class TenancyService {
  constructor(
    private readonly context: TenantContext,
    private readonly tenants: TenantRepository,
    private readonly units: UnitRepository,
    private readonly authorization: AuthorizationService,
  ) {}
  listAvailable() {
    this.context.requireIdentity();
    if (this.context.isPlatformTenantAccess())
      return this.tenants.current().then((tenant) => [tenant]);
    return this.tenants.listAvailable();
  }
  select(body: unknown) {
    this.context.requireIdentity();
    if (this.context.isPlatformTenantAccess())
      throw new ForbiddenException(
        'O tenant do modo Super Admin não pode ser alterado.',
      );
    return this.tenants.select(tenantSelection(body));
  }
  async current() {
    await this.authorization.requirePermissions('tenant.view');
    return this.tenants.current();
  }
  async listUnits() {
    await this.authorization.requirePermissions('unit.view');
    return this.units.list();
  }
  async findUnit(id: string) {
    await this.authorization.requirePermissions('unit.view');
    return this.units.findById(id);
  }
}
