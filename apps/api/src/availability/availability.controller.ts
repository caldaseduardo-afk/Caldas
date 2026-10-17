import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { RequirePermissions } from '../permissions/permission.decorator';
import { availabilityPermissions } from './availability-access';
import { structuralQuery, dateText } from './availability.dto';
import { AvailabilityService } from './availability.service';
@Controller('providers/:providerId/availability')
@RequirePermissions(...availabilityPermissions)
export class AvailabilityController {
  constructor(private readonly service: AvailabilityService) {}
  @Get() get(
    @Param('providerId', new ParseUUIDPipe()) providerId: string,
    @Query() query: unknown,
  ) {
    const input = structuralQuery(query);
    return this.service.getProviderAvailability(
      providerId,
      input.unitId,
      dateText(input.date),
    );
  }
}
