import { Injectable } from '@nestjs/common';
import { AuthorizationService } from '../permissions/authorization.service';
import { UnitRepository } from './unit.repository';
import { createUnitDto, updateUnitDto } from './unit.dto';

@Injectable()
export class UnitsService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly units: UnitRepository,
  ) {}
  async list() {
    await this.authorization.requirePermissions('unit.view');
    return this.units.listFull();
  }
  async find(id: string) {
    await this.authorization.requirePermissions('unit.view');
    return this.units.findFull(id);
  }
  async create(body: unknown) {
    await this.authorization.requirePermissions('settings.manage');
    return this.units.create(createUnitDto(body));
  }
  async update(id: string, body: unknown) {
    await this.authorization.requirePermissions('settings.manage');
    return this.units.update(id, updateUnitDto(body));
  }
  async deactivate(id: string) {
    await this.authorization.requirePermissions('settings.manage');
    return this.units.update(id, { active: false });
  }
}
