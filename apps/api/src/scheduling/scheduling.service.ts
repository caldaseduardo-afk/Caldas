import { Injectable, BadRequestException } from '@nestjs/common';
import { AuthorizationService } from '../permissions/authorization.service';
import { instant } from '../holds/hold.dto';
import { SchedulingRepository } from './scheduling.repository';
export interface SlotSearch {
  serviceId: string;
  providerId?: string;
  unitId?: string;
  startAt: string;
  endAt: string;
  limit?: number;
}
@Injectable()
export class SchedulingService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly repository: SchedulingRepository,
  ) {}
  async search(input: SlotSearch) {
    await this.authorization.requirePermissions(
      'appointment.view',
      'unit.view',
    );
    const start = instant(input.startAt),
      end = instant(input.endAt),
      limit = input.limit ?? 20;
    if (
      +end <= +start ||
      +end - +start > 7 * 86400000 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 20
    )
      throw new BadRequestException('Intervalo inválido.');
    return this.repository.search(input, start, end, limit);
  }
}
