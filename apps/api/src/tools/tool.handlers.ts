import { Injectable } from '@nestjs/common';
import { AppointmentsService } from '../appointments/appointments.service';
import { HoldsService } from '../holds/holds.service';
import { ConversationsService } from '../conversations/conversations.service';
import { SpecialtiesService } from '../catalog/specialties.service';
import { ServicesService } from '../catalog/services.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import {
  ToolContextRepository,
  type TrustedToolContext,
} from './tool-context.repository';
import { schemas, type ToolName } from './tool.schemas';
import { sanitizeAIText } from '../ai/ai-context';
import { ToolExecutionError } from './tool.errors';
import { Inject } from '@nestjs/common';
import {
  KNOWLEDGE_RETRIEVER,
  type KnowledgeRetriever,
} from '../knowledge/knowledge.types';
function appointment(row: {
  id: string;
  serviceId: string;
  providerId: string;
  unitId: string;
  startAt: Date;
  endAt: Date;
  status: string;
}) {
  return {
    appointmentId: row.id,
    serviceId: row.serviceId,
    providerId: row.providerId,
    unitId: row.unitId,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    status: row.status,
  };
}
@Injectable()
export class ToolHandlers {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly holds: HoldsService,
    private readonly conversations: ConversationsService,
    private readonly specialties: SpecialtiesService,
    private readonly services: ServicesService,
    private readonly scheduling: SchedulingService,
    private readonly contexts: ToolContextRepository,
    @Inject(KNOWLEDGE_RETRIEVER) private readonly knowledge: KnowledgeRetriever,
  ) {}
  async execute(
    name: ToolName,
    raw: unknown,
    context: TrustedToolContext,
    executionId: string,
  ): Promise<unknown> {
    switch (name) {
      case 'get_contact_context':
        return this.contexts.minimal(context);
      case 'list_specialties':
        return (await this.specialties.forAttendance()).map((v) => ({
          id: v.id,
          name: sanitizeAIText(v.name).slice(0, 200),
        }));
      case 'list_services': {
        const input = schemas.list_services.input.parse(raw);
        return (await this.services.forAttendance(input.specialtyId)).map(
          (v) => ({
            id: v.id,
            name: sanitizeAIText(v.name).slice(0, 200),
            durationMinutes: v.durationMinutes,
          }),
        );
      }
      case 'search_knowledge_base':
        return this.knowledge.search(
          schemas.search_knowledge_base.input.parse(raw),
        );
      case 'search_available_slots':
        return this.scheduling.search(
          schemas.search_available_slots.input.parse(raw),
        );
      case 'create_hold': {
        const row = await this.holds.create({
          ...schemas.create_hold.input.parse(raw),
          requestId: executionId,
          patientId: context.activePatientId,
          contactId: context.contactId,
        });
        return {
          holdId: row.id,
          startAt: row.startAt.toISOString(),
          endAt: row.endAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
          status: row.status,
        };
      }
      case 'release_hold': {
        const { holdId } = schemas.release_hold.input.parse(raw);
        await this.contexts.target(
          context,
          'appointmentHold',
          holdId,
          undefined,
          true,
        );
        const row = await this.holds.release(holdId);
        return { holdId: row.id, status: row.status };
      }
      case 'get_appointment': {
        const { appointmentId } = schemas.get_appointment.input.parse(raw);
        await this.contexts.target(context, 'appointment', appointmentId);
        return appointment(await this.appointments.find(appointmentId));
      }
      case 'list_appointments': {
        const input = schemas.list_appointments.input.parse(raw);
        if (!context.activePatientId)
          throw new ToolExecutionError('INVALID_RELATIONSHIP');
        return (
          await this.appointments.listForAI(
            context.activePatientId,
            context.contactId,
            input,
          )
        ).map((row) => ({
          ...appointment(row),
          service: sanitizeAIText(row.service.name).slice(0, 200),
          provider: sanitizeAIText(row.provider.name).slice(0, 200),
          unit: sanitizeAIText(row.unit.name).slice(0, 200),
        }));
      }
      case 'confirm_appointment': {
        const input = schemas.confirm_appointment.input.parse(raw);
        if ('holdId' in input) {
          await this.contexts.target(context, 'appointmentHold', input.holdId);
          return appointment(
            context.actorType === 'AI'
              ? await this.appointments.convertFromAI(input.holdId)
              : await this.appointments.convert({
                  holdId: input.holdId,
                  source: 'WEB',
                }),
          );
        }
        await this.contexts.target(context, 'appointment', input.appointmentId);
        const existing = await this.appointments.find(input.appointmentId);
        if (existing.status === 'CONFIRMED') return appointment(existing);
        if (existing.status !== 'PENDING_CONFIRMATION')
          throw new ToolExecutionError('INVALID_APPOINTMENT_STATE');
        return appointment(
          await this.appointments.status(input.appointmentId, {
            status: 'CONFIRMED',
          }),
        );
      }
      case 'cancel_appointment': {
        const input = schemas.cancel_appointment.input.parse(raw);
        await this.contexts.target(context, 'appointment', input.appointmentId);
        return appointment(
          await this.appointments.cancel(
            input.appointmentId,
            input.reason ? { reason: sanitizeAIText(input.reason) } : {},
          ),
        );
      }
      case 'reschedule_appointment': {
        const { appointmentId, holdId } =
          schemas.reschedule_appointment.input.parse(raw);
        await this.contexts.target(context, 'appointment', appointmentId);
        await this.contexts.target(context, 'appointmentHold', holdId);
        return appointment(
          await this.appointments.rescheduleFromHold(
            appointmentId,
            holdId,
            context.actorType === 'AI' ? 'WHATSAPP_AI' : 'WEB',
          ),
        );
      }
      case 'transfer_to_human': {
        const input = schemas.transfer_to_human.input.parse(raw);
        const row = await this.conversations.handoff(
          context.conversationId,
          'request-human',
          input,
        );
        return {
          conversationId: row.id,
          status: row.status,
          reason: row.handoffReason,
        };
      }
    }
  }
}
