import { recordAudit } from '@atendente/database';
import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../auth/database.service';
import { AuthorizationService } from '../permissions/authorization.service';
import { ContactAccess, contactWhere } from './contact-access';
import {
  createContactDto,
  updateContactDto,
  type CreateContactDto,
  type UpdateContactDto,
} from './contact.dto';
import { normalizePhone } from './phone';

@Injectable()
export class ContactRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly access: ContactAccess,
  ) {}
  async list(phone?: string) {
    const scope = await this.authorization.requirePermissions('contact.view');
    const address = phone === undefined ? undefined : normalizePhone(phone);
    return this.database.client.contact.findMany({
      where: {
        ...contactWhere(scope, 'contact.view'),
        ...(address
          ? { channels: { some: { tenantId: scope.tenantId, address } } }
          : {}),
      },
      include: {
        channels: {
          where: { tenantId: scope.tenantId },
          orderBy: { id: 'asc' },
        },
      },
      orderBy: { id: 'asc' },
    });
  }
  async find(id: string) {
    const scope = await this.authorization.requirePermissions('contact.view');
    const contact = await this.database.client.contact.findFirst({
      where: { id, ...contactWhere(scope, 'contact.view') },
      include: {
        channels: {
          where: { tenantId: scope.tenantId },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!contact) throw new NotFoundException('Contato não encontrado.');
    return contact;
  }
  create(input: CreateContactDto) {
    const dto = createContactDto(input);
    return this.access.write(async (tx, scope) => {
      const contact = await tx.contact.create({
        data: { tenantId: scope.tenantId, displayName: dto.displayName },
      });
      const explicit = dto.channels.findIndex((channel) => channel.primary);
      for (const [index, channel] of dto.channels.entries())
        await tx.contactChannel.create({
          data: {
            tenantId: scope.tenantId,
            contactId: contact.id,
            type: channel.type,
            address: channel.address,
            providerExternalId: channel.providerExternalId ?? null,
            primary: index === (explicit < 0 ? 0 : explicit),
          },
        });
      await recordAudit(tx, {
        data: {
          type: 'CONTACT_CREATED',
          userId: scope.userId,
          tenantId: scope.tenantId,
          resourceId: contact.id,
          changes: {
            fields: ['displayName', 'channels'],
            channelCount: dto.channels.length,
          },
        },
      });
      return tx.contact.findFirstOrThrow({
        where: { id: contact.id, ...contactWhere(scope, 'contact.edit') },
        include: {
          channels: {
            where: { tenantId: scope.tenantId },
            orderBy: { id: 'asc' },
          },
        },
      });
    });
  }
  update(id: string, input: UpdateContactDto) {
    const dto = updateContactDto(input);
    return this.access.write(async (tx, scope) => {
      const [contact] = await tx.contact.updateManyAndReturn({
        where: { id, ...contactWhere(scope, 'contact.edit') },
        data: { displayName: dto.displayName, status: dto.status },
      });
      if (!contact) throw new NotFoundException('Contato não encontrado.');
      await recordAudit(tx, {
        data: {
          type: 'CONTACT_UPDATED',
          userId: scope.userId,
          tenantId: scope.tenantId,
          resourceId: contact.id,
          changes: { fields: Object.keys(dto) },
        },
      });
      return contact;
    });
  }
}
