import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { ContactAccess } from './contact-access';
import { ContactRepository } from './contact.repository';
import { ContactChannelRepository } from './contact-channel.repository';
import { ContactsService } from './contacts.service';
import { ContactChannelsService } from './contact-channels.service';
import { ContactsController } from './contacts.controller';
import { ContactChannelsController } from './contact-channels.controller';
@Module({
  imports: [DatabaseModule, PermissionsModule],
  providers: [
    ContactAccess,
    ContactRepository,
    ContactChannelRepository,
    ContactsService,
    ContactChannelsService,
  ],
  controllers: [ContactsController, ContactChannelsController],
})
export class ContactsModule {}
