import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { GoogleCalendarProvider } from '@atendente/database';
import { CalendarIntegrationsController } from './calendar-integrations.controller';
import { CalendarIntegrationsRepository } from './calendar-integrations.repository';
import { CalendarIntegrationsService } from './calendar-integrations.service';

@Module({
  imports: [DatabaseModule, PermissionsModule],
  controllers: [CalendarIntegrationsController],
  providers: [
    CalendarIntegrationsRepository,
    CalendarIntegrationsService,
    {
      provide: 'CALENDAR_PROVIDER',
      useFactory: () => new GoogleCalendarProvider(),
    },
  ],
})
export class CalendarIntegrationsModule {}
