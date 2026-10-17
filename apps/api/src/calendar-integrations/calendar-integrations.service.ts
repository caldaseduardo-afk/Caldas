import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CalendarProviderError,
  type CalendarProvider,
} from '@atendente/domain';
import { calendarIntegrationDto } from './calendar-integration.dto';
import { CalendarIntegrationsRepository } from './calendar-integrations.repository';

@Injectable()
export class CalendarIntegrationsService {
  constructor(
    private readonly repository: CalendarIntegrationsRepository,
    @Inject('CALENDAR_PROVIDER') private readonly provider: CalendarProvider,
  ) {}
  get() {
    return this.repository.get();
  }
  configure(body: unknown) {
    return this.repository.configure(calendarIntegrationDto(body));
  }
  async testConnection() {
    const { row } = await this.repository.internal();
    try {
      await this.provider.testConnection(row);
      return this.repository.recordTest(row.id, true, null);
    } catch (unknownError) {
      const code =
        unknownError instanceof CalendarProviderError
          ? unknownError.code
          : 'CALENDAR_UNEXPECTED_ERROR';
      await this.repository.recordTest(row.id, false, code);
      throw new ServiceUnavailableException(
        'Não foi possível validar a integração.',
      );
    }
  }
}
