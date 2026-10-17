import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { RequirePermissions } from '../permissions/permission.decorator';
import { HumanSlaService } from './human-sla.service';
@Controller('human-sla-rules')
@RequirePermissions('settings.manage')
export class HumanSlaController {
  constructor(private readonly service: HumanSlaService) {}
  @Get() list() {
    return this.service.list();
  }
  @Get(':id') find(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.find(id);
  }
  @Post() create(@Body() body: unknown) {
    return this.service.save(undefined, body);
  }
  @Patch(':id') update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.save(id, body);
  }
  @Post(':id/preview') preview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.preview(id, body);
  }
}
