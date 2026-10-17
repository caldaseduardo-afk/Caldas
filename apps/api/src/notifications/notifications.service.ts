import { Injectable } from '@nestjs/common';
import { AuthorizationService } from '../permissions/authorization.service';
import {
  NotificationRepository,
  managePermissions,
  resolvePermissions,
} from './notification.repository';
import {
  createNotificationDto,
  updateNotificationDto,
  notificationFilter,
  previewDto,
  resolutionDto,
} from './notification.dto';
import {
  resolveNotificationSchedule,
  resolveRetrySchedule,
  skip,
} from './notification.schedule';
@Injectable()
export class NotificationsService {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly authorization: AuthorizationService,
  ) {}
  async create(body: unknown) {
    await this.authorization.requirePermissions(...managePermissions);
    return this.repository.create(createNotificationDto(body));
  }
  async update(id: string, body: unknown) {
    await this.authorization.requirePermissions(...managePermissions);
    return this.repository.update(id, updateNotificationDto(body));
  }
  async list(query: unknown) {
    await this.authorization.requirePermissions(...managePermissions);
    return this.repository.list(notificationFilter(query));
  }
  async find(id: string) {
    await this.authorization.requirePermissions(...managePermissions);
    return this.repository.find(id);
  }
  async preview(id: string, body: unknown) {
    await this.authorization.requirePermissions(...managePermissions);
    return this.calculate(id, previewDto(body));
  }
  async resolve(id: string, body: unknown) {
    await this.authorization.requirePermissions(...resolvePermissions);
    return this.calculate(id, resolutionDto(body));
  }
  private async calculate(
    id: string,
    input: ReturnType<typeof previewDto> | ReturnType<typeof resolutionDto>,
  ) {
    const { rule, appointmentStart, timezone, appointmentActive } =
      await this.repository.calculation(id, input);
    if (!appointmentActive) return skip('APPOINTMENT_INACTIVE');
    return input.previousAttemptAt !== undefined &&
      input.attemptNumber !== undefined
      ? resolveRetrySchedule(
          input.previousAttemptAt,
          appointmentStart,
          timezone,
          rule,
          input.attemptNumber,
        )
      : resolveNotificationSchedule(appointmentStart, timezone, rule);
  }
}
