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
import { availabilityPermissions } from './availability-access';
import { ScheduleExceptionsService } from './schedule-exceptions.service';
@Controller('schedule-exceptions')
@RequirePermissions(...availabilityPermissions)
export class ScheduleExceptionsController {
  constructor(private readonly service: ScheduleExceptionsService) {}
  @Get() list(@Query() query: unknown) {
    return this.service.list(query);
  }
  @Get(':id') find(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.find(id);
  }
  @Post() create(@Body() body: unknown) {
    return this.service.create(body);
  }
  @Patch(':id') update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.update(id, body);
  }
}
