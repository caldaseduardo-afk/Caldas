import { Injectable } from '@nestjs/common';
import { AuthorizationService } from '../permissions/authorization.service';
import { ContactRepository } from './contact.repository';
import {
  contactQuery,
  createContactDto,
  updateContactDto,
} from './contact.dto';

@Injectable()
export class ContactsService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly contacts: ContactRepository,
  ) {}
  async list(query: Record<string, unknown>) {
    await this.authorization.requirePermissions('contact.view');
    return this.contacts.list(contactQuery(query));
  }
  async find(id: string) {
    await this.authorization.requirePermissions('contact.view');
    return this.contacts.find(id);
  }
  async create(body: unknown) {
    await this.authorization.requirePermissions('contact.edit');
    return this.contacts.create(createContactDto(body));
  }
  async update(id: string, body: unknown) {
    await this.authorization.requirePermissions('contact.edit');
    return this.contacts.update(id, updateContactDto(body));
  }
}
