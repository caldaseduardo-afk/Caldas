import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequirePermissions } from '../permissions/permission.decorator';
import { NotificationsService } from './notifications.service';
import {
  managePermissions,
  resolvePermissions,
} from './notification.repository';
@Controller('notification-rules')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}
  @Post() @RequirePermissions(...managePermissions) create(
    @Body() body: unknown,
  ) {
    return this.service.create(body);
  }
  @Get() @RequirePermissions(...managePermissions) list(
    @Query() query: unknown,
  ) {
    return this.service.list(query);
  }
  @Get(':id') @RequirePermissions(...managePermissions) find(
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.find(id);
  }
  @Patch(':id') @RequirePermissions(...managePermissions) update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.update(id, body);
  }
  @Post(':id/preview')
  @HttpCode(200)
  @RequirePermissions(...managePermissions)
  preview(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.service.preview(id, body);
  }
  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermissions(...resolvePermissions)
  resolve(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.service.resolve(id, body);
  }
}
