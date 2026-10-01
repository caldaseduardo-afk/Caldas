import { Injectable } from '@nestjs/common';
import { AuthorizationService } from '../permissions/authorization.service';
import {
  RelationshipRepository,
  relationshipPermissions,
} from './relationship.repository';
import {
  createRelationshipDto,
  updateRelationshipDto,
} from './relationship.dto';
@Injectable()
export class RelationshipsService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly links: RelationshipRepository,
  ) {}
  async listByPatient(id: string) {
    await this.authorization.requirePermissions('patient.view', 'contact.view');
    return this.links.listByPatient(id);
  }
  async listByContact(id: string) {
    await this.authorization.requirePermissions('patient.view', 'contact.view');
    return this.links.listByContact(id);
  }
  async create(patientId: string, body: unknown) {
    const dto = createRelationshipDto(body);
    await this.authorization.requirePermissions(
      ...relationshipPermissions(dto),
    );
    return this.links.create(patientId, dto);
  }
  async update(patientId: string, id: string, body: unknown) {
    const dto = updateRelationshipDto(body);
    await this.authorization.requirePermissions(
      ...relationshipPermissions(dto),
    );
    return this.links.update(patientId, id, dto);
  }
  async revoke(patientId: string, id: string) {
    await this.authorization.requirePermissions(...relationshipPermissions());
    return this.links.revoke(patientId, id);
  }
}
