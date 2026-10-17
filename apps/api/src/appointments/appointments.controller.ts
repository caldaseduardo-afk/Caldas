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
import { AppointmentsService } from './appointments.service';
import {
  createPermissions,
  readPermissions,
  releasePermissions,
  reschedulePermissions,
  statusPermissions,
} from './appointment-access';
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly service: AppointmentsService) {}
  @Post() @RequirePermissions(...createPermissions) create(
    @Body() body: unknown,
  ) {
    return this.service.create(body);
  }
  @Post('from-hold') @RequirePermissions(...createPermissions) convert(
    @Body() body: unknown,
  ) {
    return this.service.convert(body);
  }
  @Get() @RequirePermissions(...readPermissions) list(@Query() query: unknown) {
    return this.service.list(query);
  }
  @Get(':id') @RequirePermissions(...readPermissions) find(
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.find(id);
  }
  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(...releasePermissions)
  cancel(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.service.cancel(id, body);
  }
  @Post(':id/reschedule')
  @RequirePermissions(...reschedulePermissions)
  reschedule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.reschedule(id, body);
  }
  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions(...statusPermissions)
  status(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.service.status(id, body);
  }
}
