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
import { ConversationsService } from './conversations.service';
import { viewPermissions, replyPermissions } from './conversation-access';
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly service: ConversationsService) {}
  @Post() @HttpCode(200) @RequirePermissions(...replyPermissions) getOrCreate(
    @Body() body: unknown,
  ) {
    return this.service.getOrCreate(body);
  }
  @Get() @RequirePermissions(...viewPermissions) list(@Query() query: unknown) {
    return this.service.list(query);
  }
  @Get(':id') @RequirePermissions(...viewPermissions) find(
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.find(id);
  }
  @Patch(':id') @RequirePermissions(...replyPermissions) update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.update(id, body);
  }
  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions(...replyPermissions)
  status(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.service.status(id, body);
  }
  @Post(':id/request-human')
  @HttpCode(200)
  @RequirePermissions(...viewPermissions, 'conversation.reply')
  requestHuman(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.handoff(id, 'request-human', body);
  }
  @Post(':id/claim')
  @HttpCode(200)
  @RequirePermissions(
    ...viewPermissions,
    'conversation.assign',
    'conversation.reply',
  )
  claim(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.service.handoff(id, 'claim', body);
  }
  @Post(':id/transfer')
  @HttpCode(200)
  @RequirePermissions(...viewPermissions, 'conversation.transfer')
  transfer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.handoff(id, 'transfer', body);
  }
  @Post(':id/return-to-ai')
  @HttpCode(200)
  @RequirePermissions(...viewPermissions, 'conversation.transfer')
  returnToAi(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.handoff(id, 'return-to-ai', body);
  }
  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermissions(...viewPermissions, 'conversation.close')
  resolve(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.service.handoff(id, 'resolve', body);
  }
  @Post(':id/messages') @RequirePermissions(...replyPermissions) reply(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.reply(id, body);
  }
  @Get(':id/messages') @RequirePermissions(...viewPermissions) messages(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: unknown,
  ) {
    return this.service.messages(id, query);
  }
  @Get(':id/messages/:messageId')
  @RequirePermissions(...viewPermissions)
  message(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('messageId', new ParseUUIDPipe()) messageId: string,
  ) {
    return this.service.message(id, messageId);
  }
}
