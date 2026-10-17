import { Injectable } from '@nestjs/common';
import { AuthorizationService } from '../permissions/authorization.service';
import { AvailabilityRepository } from './availability.repository';
import { availabilityPermissions } from './availability-access';
import { civilDate, dateText, timeText, uuid } from './availability.dto';
import { structuralWindows } from './availability.windows';
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly repository: AvailabilityRepository,
  ) {}
  async getProviderAvailability(
    providerId: string,
    unitId: string,
    date: string,
  ) {
    await this.authorization.requirePermissions(...availabilityPermissions);
    const day = civilDate(date);
    const row = await this.repository.load(uuid(providerId), uuid(unitId), day);
    return {
      date: dateText(day),
      timezone: row.unit.timezoneOverride ?? row.tenant.timezone,
      windows:
        row.active && row.provider.active && row.unit.active
          ? structuralWindows(
              row.availabilityRules.map((r) => ({
                start: timeText(r.startTime),
                end: timeText(r.endTime),
              })),
              row.scheduleExceptions.map((e) => ({
                type: e.type,
                startTime: e.startTime ? timeText(e.startTime) : null,
                endTime: e.endTime ? timeText(e.endTime) : null,
              })),
            )
          : [],
    };
  }
}
