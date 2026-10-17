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
import { ProviderUnitsService } from './provider-units.service';
import { providerUnitPermissions } from './provider-access';
@Controller('providers/:providerId/units')
@RequirePermissions(...providerUnitPermissions)
export class ProviderUnitsController {
  constructor(private readonly service: ProviderUnitsService) {}
  @Get() list(
    @Param('providerId', new ParseUUIDPipe()) providerId: string,
    @Query() query: unknown,
  ) {
    return this.service.list(providerId, query);
  }
  @Post() create(
    @Param('providerId', new ParseUUIDPipe()) providerId: string,
    @Body() body: unknown,
  ) {
    return this.service.create(providerId, body);
  }
  @Patch(':id') update(
    @Param('providerId', new ParseUUIDPipe()) providerId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.update(providerId, id, body);
  }
}
