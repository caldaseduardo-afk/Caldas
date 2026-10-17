import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { RequirePermissions } from '../permissions/permission.decorator';
import {
  createPermissions,
  readPermissions,
  releasePermissions,
} from './hold-access';
import { HoldsService } from './holds.service';
@Controller('appointment-holds')
export class HoldsController {
  constructor(private readonly service: HoldsService) {}
  @Post() @RequirePermissions(...createPermissions) create(
    @Body() body: unknown,
  ) {
    return this.service.create(body);
  }
  @Get('active') @RequirePermissions(...readPermissions) active(
    @Query() query: unknown,
  ) {
    return this.service.active(query);
  }
  @Get(':id') @RequirePermissions(...readPermissions) find(
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.find(id);
  }
  @Post(':id/release')
  @HttpCode(200)
  @RequirePermissions(...releasePermissions)
  release(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.release(id);
  }
}
