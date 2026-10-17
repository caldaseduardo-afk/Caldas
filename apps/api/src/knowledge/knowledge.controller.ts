import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequirePermissions } from '../permissions/permission.decorator';
import { KnowledgeService } from './knowledge.service';
@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly service: KnowledgeService) {}
  @Get('articles') @RequirePermissions('knowledge.view') list(
    @Query() query: unknown,
  ) {
    return this.service.list(query);
  }
  @Post('articles') @RequirePermissions('knowledge.manage') create(
    @Body() body: unknown,
  ) {
    return this.service.create(body);
  }
  @Post('search/preview') @RequirePermissions('knowledge.view') search(
    @Body() body: unknown,
  ) {
    return this.service.search(body);
  }
  @Get('articles/:id') @RequirePermissions('knowledge.view') find(
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.find(id);
  }
  @Patch('articles/:id') @RequirePermissions('knowledge.manage') update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.update(id, body);
  }
  @Post('articles/:id/versions')
  @RequirePermissions('knowledge.manage')
  newVersion(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.newVersion(id, body);
  }
  @Get('articles/:id/versions') @RequirePermissions('knowledge.view') versions(
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.find(id).then((v) => v.versions);
  }
  @Get('articles/:id/published')
  @RequirePermissions('knowledge.view')
  published(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.published(id);
  }
  @Post('articles/:id/versions/:version/publish')
  @RequirePermissions('knowledge.publish')
  publish(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() body: unknown,
  ) {
    return this.service.publish(id, version, body);
  }
  @Post('articles/:id/inactivate')
  @RequirePermissions('knowledge.manage')
  inactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.inactivate(id, body);
  }
}
