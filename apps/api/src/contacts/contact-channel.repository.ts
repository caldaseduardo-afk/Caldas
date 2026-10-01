import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContactAccess, contactWhere, lockContact } from './contact-access';
import {
  createChannelDto,
  updateChannelDto,
  type CreateChannelDto,
  type UpdateChannelDto,
} from './contact.dto';

@Injectable()
export class ContactChannelRepository {
  constructor(private readonly access: ContactAccess) {}
  create(contactId: string, input: CreateChannelDto) {
    const dto = createChannelDto(input);
    return this.access.write(async (tx, scope) => {
      await lockContact(tx, scope, contactId);
      const where = {
        tenantId: scope.tenantId,
        contactId,
        contact: contactWhere(scope, 'contact.edit'),
      };
      const first = (await tx.contactChannel.count({ where })) === 0;
      const primary = first || dto.primary === true;
      if (primary)
        await tx.contactChannel.updateMany({
          where: { ...where, primary: true },
          data: { primary: false },
        });
      const channel = await tx.contactChannel.create({
        data: {
          tenantId: scope.tenantId,
          contactId,
          type: dto.type,
          address: dto.address,
          providerExternalId: dto.providerExternalId ?? null,
          primary,
        },
      });
      await tx.authEvent.create({
        data: {
          type: 'CONTACT_CHANNEL_CREATED',
          userId: scope.userId,
          tenantId: scope.tenantId,
          resourceId: channel.id,
          changes: {
            contactId,
            fields: ['type', 'address', 'providerExternalId', 'primary'],
          },
        },
      });
      return channel;
    });
  }
  update(contactId: string, id: string, input: UpdateChannelDto) {
    const dto = updateChannelDto(input);
    return this.access.write(async (tx, scope) => {
      await lockContact(tx, scope, contactId);
      const where = {
        tenantId: scope.tenantId,
        contactId,
        contact: contactWhere(scope, 'contact.edit'),
      };
      const before = await tx.contactChannel.findFirst({
        where: { id, ...where },
      });
      if (!before) throw new NotFoundException('Canal não encontrado.');
      if (before.primary && dto.primary === false)
        throw new ConflictException('Defina outro canal como principal.');
      if (dto.primary === true)
        await tx.contactChannel.updateMany({
          where: { ...where, primary: true, NOT: { id } },
          data: { primary: false },
        });
      const changedAddress =
        dto.address !== undefined && dto.address !== before.address;
      const [channel] = await tx.contactChannel.updateManyAndReturn({
        where: { id, ...where },
        data: {
          address: dto.address,
          primary: dto.primary,
          providerExternalId:
            dto.providerExternalId !== undefined
              ? dto.providerExternalId
              : changedAddress
                ? null
                : undefined,
          ...(changedAddress ? { verifiedAt: null } : {}),
        },
      });
      if (!channel) throw new NotFoundException('Canal não encontrado.');
      await tx.authEvent.create({
        data: {
          type: 'CONTACT_CHANNEL_UPDATED',
          userId: scope.userId,
          tenantId: scope.tenantId,
          resourceId: channel.id,
          changes: {
            contactId,
            fields: Object.keys(dto),
            identityReset: changedAddress,
          },
        },
      });
      return channel;
    });
  }
}
