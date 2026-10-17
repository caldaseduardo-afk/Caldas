import { Injectable } from '@nestjs/common';
import { AuthorizationService } from '../permissions/authorization.service';
import { HoldRepository } from './hold.repository';
import {
  createPermissions,
  readPermissions,
  releasePermissions,
} from './hold-access';
import { createHoldDto, activeHoldsQuery } from './hold.dto';
@Injectable()
export class HoldsService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly repository: HoldRepository,
  ) {}
  async create(body: unknown) {
    await this.authorization.requirePermissions(...createPermissions);
    return this.repository.create(createHoldDto(body));
  }
  async find(id: string) {
    await this.authorization.requirePermissions(...readPermissions);
    return this.repository.find(id);
  }
  async active(query: unknown) {
    await this.authorization.requirePermissions(...readPermissions);
    return this.repository.active(activeHoldsQuery(query));
  }
  async release(id: string) {
    await this.authorization.requirePermissions(...releasePermissions);
    return this.repository.release(id);
  }
}
