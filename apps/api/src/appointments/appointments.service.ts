import { Injectable } from '@nestjs/common';
import { AuthorizationService } from '../permissions/authorization.service';
import { AppointmentRepository } from './appointment.repository';
import {
  createPermissions,
  readPermissions,
  releasePermissions,
  reschedulePermissions,
  statusPermissions,
} from './appointment-access';
import {
  appointmentDto,
  conversionDto,
  rescheduleDto,
  cancellationDto,
  statusDto,
  appointmentsQuery,
} from './appointment.dto';
@Injectable()
export class AppointmentsService {
  constructor(
    private readonly repository: AppointmentRepository,
    private readonly authorization: AuthorizationService,
  ) {}
  async create(body: unknown) {
    await this.authorization.requirePermissions(...createPermissions);
    return this.repository.create(appointmentDto(body));
  }
  async convert(body: unknown) {
    await this.authorization.requirePermissions(...createPermissions);
    return this.repository.convert(conversionDto(body));
  }
  async convertFromAI(holdId: string) {
    await this.authorization.requirePermissions(...createPermissions);
    return this.repository.convert({
      ...conversionDto({ holdId }),
      source: 'WHATSAPP_AI',
    });
  }
  async find(id: string) {
    await this.authorization.requirePermissions(...readPermissions);
    return this.repository.find(id);
  }
  async list(query: unknown) {
    await this.authorization.requirePermissions(...readPermissions);
    return this.repository.list(appointmentsQuery(query));
  }
  async calendar(query: unknown) {
    await this.authorization.requirePermissions(...readPermissions);
    return this.repository.calendar(appointmentsQuery(query));
  }
  async listForAI(
    patientId: string,
    contactId: string,
    input: {
      startAt?: string;
      endAt?: string;
      serviceId?: string;
      limit?: number;
    },
  ) {
    await this.authorization.requirePermissions(...readPermissions);
    return this.repository.listForAI(patientId, contactId, {
      ...(input.startAt ? { startAt: new Date(input.startAt) } : {}),
      ...(input.endAt ? { endAt: new Date(input.endAt) } : {}),
      ...(input.serviceId ? { serviceId: input.serviceId } : {}),
      limit: input.limit ?? 5,
    });
  }
  async cancel(id: string, body: unknown) {
    await this.authorization.requirePermissions(...releasePermissions);
    return this.repository.transition(
      id,
      'CANCELLED',
      cancellationDto(body).reason,
    );
  }
  async reschedule(id: string, body: unknown) {
    await this.authorization.requirePermissions(...reschedulePermissions);
    return this.repository.reschedule(id, rescheduleDto(body));
  }
  async rescheduleFromHold(
    id: string,
    holdId: string,
    source: 'WHATSAPP_AI' | 'WEB',
  ) {
    await this.authorization.requirePermissions(...reschedulePermissions);
    return this.repository.rescheduleFromHold(id, holdId, source);
  }
  async status(id: string, body: unknown) {
    await this.authorization.requirePermissions(...statusPermissions);
    return this.repository.transition(id, statusDto(body));
  }
}
