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
import { SpecialtiesService } from './specialties.service';
@Controller('specialties')
@RequirePermissions('service.manage')
export class SpecialtiesController {
  constructor(private readonly service: SpecialtiesService) {}
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
