import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequirePermissions } from '../permissions/permission.decorator';
import { ContactsService } from './contacts.service';

@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}
  @Get() @RequirePermissions('contact.view') list(
    @Query() query: Record<string, unknown>,
  ) {
    return this.contacts.list(query);
  }
  @Get(':id') @RequirePermissions('contact.view') find(
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.contacts.find(id);
  }
  @Post() @RequirePermissions('contact.edit') create(@Body() body: unknown) {
    return this.contacts.create(body);
  }
  @Patch(':id') @RequirePermissions('contact.edit') update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.contacts.update(id, body);
  }
}
