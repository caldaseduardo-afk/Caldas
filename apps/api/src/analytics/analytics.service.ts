import { Injectable } from '@nestjs/common';
import type { DashboardResponse } from '@atendente/types';
import { AuthorizationService } from '../permissions/authorization.service';
import { AnalyticsRepository } from './analytics.repository';
import { dashboardQuery, optionsQuery } from './analytics.dto';
import { addDays, appointmentMetrics, rate } from './analytics.metrics';
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly repository: AnalyticsRepository,
  ) {}
  async dashboard(raw: unknown): Promise<DashboardResponse> {
    const query = dashboardQuery(raw),
      scope = await this.authorization.requirePermissions('analytics.view');
    const data = await this.repository.aggregate(scope, query);
    const dates: string[] = [];
    for (
      let day = data.period.from;
      day <= data.period.to;
      day = addDays(day, 1)
    )
      dates.push(day);
    const sources = [
      'WHATSAPP_AI',
      'WHATSAPP_HUMAN',
      'WEB',
      'PHONE',
      'MANUAL',
      'IMPORT',
    ].map((source) => ({
      source,
      count: data.appointments
        .filter((r) => r.source === source)
        .reduce((n, r) => n + r.count, 0),
    }));
    return {
      generatedAt: data.now.toISOString(),
      period: data.period,
      filters: {
        unitId: query.unitId,
        serviceId: query.serviceId,
        providerId: query.providerId,
      },
      appointments: { ...appointmentMetrics(data.appointments), sources },
      appointmentSeries: dates.map((date) => ({
        date,
        ...appointmentMetrics(data.appointments.filter((r) => r.date === date)),
      })),
      conversations: data.conversations,
      current: data.current,
      humanService: data.humanService,
      conversationSeries: dates.map(
        (date) =>
          data.conversationSeries.find((r) => r.date === date) ?? {
            date,
            total: 0,
            messages: 0,
            aiMessages: 0,
            humanMessages: 0,
            handoffs: 0,
          },
      ),
      conversion: {
        ...data.conversion,
        rate: rate(data.conversion.completed, data.conversion.started),
      },
      rankings: data.rankings,
    };
  }
  async options(raw: unknown) {
    const query = optionsQuery(raw),
      scope = await this.authorization.requirePermissions('analytics.view');
    return this.repository.options(scope, query);
  }
}
