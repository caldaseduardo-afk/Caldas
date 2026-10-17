import { Injectable } from '@nestjs/common';
import { AuthorizationService } from '../permissions/authorization.service';
import { HumanSlaRepository } from './human-sla.repository';
import { humanSlaDto, previewDate } from './human-sla.dto';
@Injectable()
export class HumanSlaService {
  constructor(
    private readonly repository: HumanSlaRepository,
    private readonly authorization: AuthorizationService,
  ) {}
  async list() {
    await this.authorization.requirePermissions('settings.manage');
    return this.repository.list();
  }
  async find(id: string) {
    await this.authorization.requirePermissions('settings.manage');
    return this.repository.find(id);
  }
  async save(id: string | undefined, body: unknown) {
    await this.authorization.requirePermissions('settings.manage');
    return this.repository.save(id, humanSlaDto(body, !!id));
  }
  async preview(id: string, body: unknown) {
    await this.authorization.requirePermissions('settings.manage');
    return this.repository.preview(id, previewDate(body));
  }
}
