import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { RequirePermissions } from '../permissions/permission.decorator';
import { ProviderServicesService } from './provider-services.service';
import { providerServicePermissions } from './provider-access';
@Controller('services/:serviceId/providers')
@RequirePermissions(...providerServicePermissions)
export class EligibleProvidersController {
  constructor(private readonly service: ProviderServicesService) {}
  @Get() list(@Param('serviceId', new ParseUUIDPipe()) serviceId: string) {
    return this.service.listEligible(serviceId);
  }
}
