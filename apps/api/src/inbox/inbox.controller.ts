import { Controller, Get, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import { RequirePermissions } from '../permissions/permission.decorator';
import { viewPermissions } from '../conversations/conversation-access';
import { InboxService } from './inbox.service';
@Controller('inbox')
@RequirePermissions(...viewPermissions)
export class InboxController {
  constructor(private readonly service: InboxService) {}
  @Get('session') session() {
    return this.service.session();
  }
  @Get('assignees')
  @RequirePermissions('conversation.transfer')
  assignees(@Query() query: unknown) {
    return this.service.assignees(query);
  }
  @Get('conversations') list(@Query() query: unknown) {
    return this.service.list(query);
  }
  @Get('conversations/:id') detail(
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.detail(id);
  }
  @Get('conversations/:id/messages') history(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: unknown,
  ) {
    return this.service.history(id, query);
  }
}
