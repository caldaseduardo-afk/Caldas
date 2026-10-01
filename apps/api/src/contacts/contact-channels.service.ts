import { Injectable } from '@nestjs/common';
import { AuthorizationService } from '../permissions/authorization.service';
import { ContactChannelRepository } from './contact-channel.repository';
import { createChannelDto, updateChannelDto } from './contact.dto';

@Injectable()
export class ContactChannelsService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly channels: ContactChannelRepository,
  ) {}
  async create(contactId: string, body: unknown) {
    await this.authorization.requirePermissions('contact.edit');
    return this.channels.create(contactId, createChannelDto(body));
  }
  async update(contactId: string, id: string, body: unknown) {
    await this.authorization.requirePermissions('contact.edit');
    return this.channels.update(contactId, id, updateChannelDto(body));
  }
}
