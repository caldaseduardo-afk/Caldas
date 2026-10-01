import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { RequirePermissions } from '../permissions/permission.decorator';
import { ContactChannelsService } from './contact-channels.service';

@Controller('contacts/:contactId/channels')
export class ContactChannelsController {
  constructor(private readonly channels: ContactChannelsService) {}
  @Post() @RequirePermissions('contact.edit') create(
    @Param('contactId', new ParseUUIDPipe()) contactId: string,
    @Body() body: unknown,
  ) {
    return this.channels.create(contactId, body);
  }
  @Patch(':id') @RequirePermissions('contact.edit') update(
    @Param('contactId', new ParseUUIDPipe()) contactId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.channels.update(contactId, id, body);
  }
}
