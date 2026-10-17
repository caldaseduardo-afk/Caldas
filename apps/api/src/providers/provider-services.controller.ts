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
import { ProviderServicesService } from './provider-services.service';
import { providerServicePermissions } from './provider-access';
@Controller('providers/:providerId/services')
@RequirePermissions(...providerServicePermissions)
export class ProviderServicesController {
  constructor(private readonly service: ProviderServicesService) {}
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
