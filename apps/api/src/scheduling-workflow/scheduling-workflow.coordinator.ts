import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { EngineGrant } from '../conversation-engine/conversation-engine.repository';
import type { ConversationEngineOutput } from '../conversation-engine/conversation-engine.output';
import { ToolGateway } from '../tools/tool-gateway.service';
import { schemas } from '../tools/tool.schemas';
import type { ToolResult } from '../tools/tool.errors';
import {
  SchedulingWorkflowRepository,
  type PersistedSlot,
  type PersistedAppointment,
  type SchedulingWorkflowView,
} from './scheduling-workflow.repository';

type SchedulingCommand = NonNullable<ConversationEngineOutput['scheduling']>;

export interface SchedulingWorkflowResult {
  workflow: ReturnType<typeof serializeWorkflow> | null;
  action: SchedulingCommand['action'];
  toolResult?: ToolResult;
  contactContext?: unknown;
  noAvailability?: boolean;
  noAppointments?: boolean;
  toolCalls?: number;
}

function serializeWorkflow(workflow: SchedulingWorkflowView | null) {
  if (!workflow) return null;
  return {
    type: workflow.workflowType,
    step: workflow.step,
    patient: workflow.patient
      ? { id: workflow.patientId, name: workflow.patient.name }
      : null,
    specialty: workflow.specialty
      ? { id: workflow.specialtyId, name: workflow.specialty.name }
      : null,
    service: workflow.service
      ? {
          id: workflow.serviceId,
          name: workflow.service.name,
          durationMinutes: workflow.service.durationMinutes,
        }
      : null,
    provider: workflow.provider
      ? { id: workflow.providerId, name: workflow.provider.name }
      : null,
    unit: workflow.unit
      ? { id: workflow.unitId, name: workflow.unit.name }
      : null,
    preferredDate: workflow.preferredDate?.toISOString().slice(0, 10) ?? null,
    preferredPeriod: workflow.preferredPeriod,
    hold: workflow.holdId
      ? {
          id: workflow.holdId,
          status: workflow.hold?.status ?? null,
          expiresAt: workflow.hold?.expiresAt.toISOString() ?? null,
        }
      : null,
    appointment: workflow.appointment
      ? {
          id: workflow.appointment.id,
          status: workflow.appointment.status,
          startAt: workflow.appointment.startAt.toISOString(),
          endAt: workflow.appointment.endAt.toISOString(),
        }
      : null,
    targetAppointment: workflow.targetAppointment
      ? {
          id: workflow.targetAppointment.id,
          status: workflow.targetAppointment.status,
          patient: workflow.targetAppointment.patient.name,
          service: workflow.targetAppointment.service.name,
          provider: workflow.targetAppointment.provider.name,
          unit: workflow.targetAppointment.unit.name,
          startAt: workflow.targetAppointment.startAt.toISOString(),
          endAt: workflow.targetAppointment.endAt.toISOString(),
        }
      : null,
    appointmentOptions: workflow.appointmentOptions.map((option) => ({
      number: option.optionNumber,
      service: option.appointment.service.name,
      provider: option.appointment.provider.name,
      unit: option.appointment.unit.name,
      startAt: option.appointment.startAt.toISOString(),
      endAt: option.appointment.endAt.toISOString(),
      status: option.appointment.status,
    })),
    options: workflow.options.map((option) => ({
      number: option.optionNumber,
      service: option.service.name,
      provider: option.provider.name,
      unit: option.unit.name,
      startAt: option.startAt.toISOString(),
      endAt: option.endAt.toISOString(),
      timezone: option.timezone,
    })),
  };
}

@Injectable()
export class SchedulingWorkflowCoordinator {
  private readonly logger = new Logger(SchedulingWorkflowCoordinator.name);

  constructor(
    private readonly repository: SchedulingWorkflowRepository,
    private readonly tools: ToolGateway,
  ) {}

  async context(grant: EngineGrant) {
    return serializeWorkflow(await this.repository.reconcile(grant));
  }

  async execute(
    grant: EngineGrant,
    command: SchedulingCommand,
  ): Promise<SchedulingWorkflowResult> {
    switch (command.action) {
      case 'NONE':
        return {
          action: command.action,
          workflow: serializeWorkflow(await this.repository.reconcile(grant)),
        };
      case 'START':
        return this.start(grant, command.action, 'SCHEDULING', command);
      case 'START_CANCELLATION':
        return this.start(grant, command.action, 'CANCELLATION', command);
      case 'START_RESCHEDULING':
        return this.start(grant, command.action, 'RESCHEDULING', command);
      case 'SELECT_PATIENT': {
        if (!command.patientId) throw new Error('SCHEDULING_PATIENT_REQUIRED');
        await this.releaseCurrent(grant);
        const workflow = await this.repository.selectPatient(
          grant,
          command.patientId,
        );
        this.metric('patient_identified', grant, workflow);
        if (workflow.workflowType !== 'SCHEDULING')
          return this.findAppointments(grant, command.action, command);
        return {
          action: command.action,
          workflow: serializeWorkflow(workflow),
        };
      }
      case 'LIST_APPOINTMENTS':
        return this.findAppointments(grant, command.action, command);
      case 'SELECT_APPOINTMENT': {
        if (!command.optionNumber)
          throw new Error('SCHEDULING_OPTION_REQUIRED');
        const workflow = await this.repository.selectAppointment(
          grant,
          command.optionNumber,
        );
        this.metric('appointment_identified', grant, workflow);
        return {
          action: command.action,
          workflow: serializeWorkflow(workflow),
        };
      }
      case 'SELECT_SERVICE': {
        if (!command.serviceId) throw new Error('SCHEDULING_SERVICE_REQUIRED');
        await this.releaseCurrent(grant);
        const workflow = await this.repository.selectService(grant, {
          serviceId: command.serviceId,
          specialtyId: command.specialtyId,
          providerId: command.providerId,
          unitId: command.unitId,
        });
        this.metric('service_identified', grant, workflow);
        return {
          action: command.action,
          workflow: serializeWorkflow(workflow),
        };
      }
      case 'SET_PREFERENCES': {
        if (!command.preferredDate || !command.preferredPeriod)
          throw new Error('SCHEDULING_PREFERENCES_REQUIRED');
        await this.releaseCurrent(grant);
        const workflow = await this.repository.preferences(
          grant,
          command.preferredDate,
          command.preferredPeriod,
        );
        return {
          action: command.action,
          workflow: serializeWorkflow(workflow),
        };
      }
      case 'SEARCH_SLOTS':
        return this.search(grant, command.action);
      case 'SELECT_SLOT':
        if (!command.optionNumber)
          throw new Error('SCHEDULING_OPTION_REQUIRED');
        return this.hold(grant, command.optionNumber, command.action);
      case 'CONFIRM':
        return this.confirm(grant, command.action);
      case 'CHANGE_SELECTION':
        return this.change(grant, command);
      case 'ABANDON': {
        await this.releaseCurrent(grant);
        const workflow = await this.repository.abandon(grant);
        this.metric(
          `ai_${workflow.workflowType.toLowerCase()}_abandoned`,
          grant,
          workflow,
        );
        return {
          action: command.action,
          workflow: serializeWorkflow(workflow),
        };
      }
    }
  }

  async handoff(grant: EngineGrant) {
    const current = await this.repository.load(grant);
    if (!current) return;
    await this.repository.abandon(grant, true);
    this.metric('ai_change_handoff', grant, current);
  }

  private async start(
    grant: EngineGrant,
    action: SchedulingCommand['action'],
    type: 'SCHEDULING' | 'CANCELLATION' | 'RESCHEDULING',
    command: SchedulingCommand,
  ): Promise<SchedulingWorkflowResult> {
    const previous = await this.repository.load(grant);
    if (previous && previous.workflowType !== type)
      await this.releaseCurrent(grant);
    let workflow = await this.repository.start(grant, type);
    const turn = await this.tools.beginTurn({
      conversationId: grant.conversationId,
      actorType: 'AI',
      correlationId: grant.correlationId,
    });
    const result = await this.tools.executeTool(
      {
        name: 'get_contact_context',
        arguments: {},
        callId: `sched_context_${randomUUID()}`,
      },
      turn,
    );
    if (!result.success)
      return {
        action,
        workflow: serializeWorkflow(workflow),
        toolResult: result,
      };
    const contact = schemas.get_contact_context.output.parse(result.data);
    const active = contact.patients.find(
      (patient) => patient.patientId === contact.activePatientId,
    );
    const self = contact.patients.filter(
      (patient) => patient.relationship === 'SELF',
    );
    if (active || (contact.patients.length === 1 && self.length === 1)) {
      const selected = active ?? self[0];
      if (!selected) throw new Error('SCHEDULING_PATIENT_REQUIRED');
      workflow = await this.repository.selectPatient(grant, selected.patientId);
      this.metric('patient_identified', grant, workflow);
    }
    this.metric(`ai_${type.toLowerCase()}_started`, grant, workflow);
    if (workflow.patientId && type !== 'SCHEDULING') {
      const appointments = await this.findAppointments(grant, action, command);
      return {
        ...appointments,
        contactContext: contact,
        toolCalls: (appointments.toolCalls ?? 0) + 1,
      };
    }
    return {
      action,
      workflow: serializeWorkflow(workflow),
      contactContext: contact,
      toolCalls: 1,
    };
  }

  private async search(
    grant: EngineGrant,
    action: SchedulingCommand['action'],
  ): Promise<SchedulingWorkflowResult> {
    const search = await this.repository.searchArguments(grant);
    const turn = await this.tools.beginTurn({
      conversationId: grant.conversationId,
      actorType: 'AI',
      correlationId: grant.correlationId,
    });
    const result = await this.tools.executeTool(
      {
        name: 'search_available_slots',
        arguments: search.arguments,
        callId: `sched_search_${randomUUID()}`,
      },
      turn,
    );
    if (!result.success)
      return {
        action,
        workflow: serializeWorkflow(search.workflow),
        toolResult: result,
      };
    const slots = schemas.search_available_slots.output.parse(
      result.data,
    ) as PersistedSlot[];
    const workflow = await this.repository.saveOptions(grant, slots);
    this.metric('slots_searched', grant, workflow);
    return {
      action,
      workflow: serializeWorkflow(workflow),
      toolResult: result,
      noAvailability: slots.length === 0,
      toolCalls: 1,
    };
  }

  private async findAppointments(
    grant: EngineGrant,
    action: SchedulingCommand['action'],
    command: SchedulingCommand,
  ): Promise<SchedulingWorkflowResult> {
    const search = await this.repository.appointmentSearchArguments(grant, {
      date: command.preferredDate,
      serviceId: command.serviceId,
    });
    const turn = await this.tools.beginTurn({
      conversationId: grant.conversationId,
      actorType: 'AI',
      correlationId: grant.correlationId,
    });
    const result = await this.tools.executeTool(
      {
        name: 'list_appointments',
        arguments: search.arguments,
        callId: `sched_appointments_${randomUUID()}`,
      },
      turn,
    );
    if (!result.success)
      return {
        action,
        workflow: serializeWorkflow(search.workflow),
        toolResult: result,
        toolCalls: 1,
      };
    const appointments = schemas.list_appointments.output.parse(
      result.data,
    ) as PersistedAppointment[];
    let workflow = await this.repository.saveAppointmentOptions(
      grant,
      appointments,
    );
    if (appointments.length === 1)
      workflow = await this.repository.selectAppointment(grant, 1);
    this.metric('appointments_searched', grant, workflow);
    return {
      action,
      workflow: serializeWorkflow(workflow),
      toolResult: result,
      noAppointments: appointments.length === 0,
      toolCalls: 1,
    };
  }

  private async hold(
    grant: EngineGrant,
    optionNumber: number,
    action: SchedulingCommand['action'],
  ): Promise<SchedulingWorkflowResult> {
    await this.releaseCurrent(grant);
    const { workflow, option } = await this.repository.option(
      grant,
      optionNumber,
    );
    const args = {
      serviceId: option.serviceId,
      providerId: option.providerId,
      unitId: option.unitId,
      startAt: option.startAt.toISOString(),
    };
    const turn = await this.tools.beginTurn({
      conversationId: grant.conversationId,
      actorType: 'AI',
      correlationId: grant.correlationId,
      approvedMutations: [{ name: 'create_hold', arguments: args }],
    });
    const result = await this.tools.executeTool(
      {
        name: 'create_hold',
        arguments: args,
        callId: `sched_${workflow.id}_${workflow.version}_${optionNumber}_hold`,
      },
      turn,
    );
    if (!result.success) {
      this.metric(
        workflow.workflowType === 'RESCHEDULING' &&
          result.error?.code === 'SLOT_UNAVAILABLE'
          ? 'ai_rescheduling_slot_conflict'
          : 'hold_failed',
        grant,
        workflow,
        result.error?.code,
      );
      if (result.error?.code === 'SLOT_UNAVAILABLE')
        return this.search(grant, action);
      return {
        action,
        workflow: serializeWorkflow(workflow),
        toolResult: result,
      };
    }
    const hold = schemas.create_hold.output.parse(result.data);
    const updated = await this.repository.setHold(grant, optionNumber, hold);
    this.metric('hold_created', grant, updated);
    return {
      action,
      workflow: serializeWorkflow(updated),
      toolResult: result,
      toolCalls: 2,
    };
  }

  private async confirm(
    grant: EngineGrant,
    action: SchedulingCommand['action'],
  ): Promise<SchedulingWorkflowResult> {
    const workflow = await this.repository.reconcile(grant);
    if (!workflow) return { action, workflow: serializeWorkflow(workflow) };
    if (
      workflow.workflowType === 'CANCELLATION' &&
      workflow.step === 'WAITING_CANCELLATION_CONFIRMATION' &&
      workflow.targetAppointmentId
    ) {
      const args = { appointmentId: workflow.targetAppointmentId };
      const turn = await this.tools.beginTurn({
        conversationId: grant.conversationId,
        actorType: 'AI',
        correlationId: grant.correlationId,
        approvedMutations: [{ name: 'cancel_appointment', arguments: args }],
      });
      const result = await this.tools.executeTool(
        {
          name: 'cancel_appointment',
          arguments: args,
          callId: `sched_${workflow.id}_${workflow.version}_cancel`,
        },
        turn,
      );
      if (!result.success)
        return {
          action,
          workflow: serializeWorkflow(await this.repository.reconcile(grant)),
          toolResult: result,
          toolCalls: 1,
        };
      const appointment = schemas.cancel_appointment.output.parse(result.data);
      const completed = await this.repository.completeCancellation(
        grant,
        appointment.appointmentId,
      );
      this.metric('ai_cancellation_completed', grant, completed);
      return {
        action,
        workflow: serializeWorkflow(completed),
        toolResult: result,
        toolCalls: 1,
      };
    }
    if (
      workflow.workflowType === 'RESCHEDULING' &&
      workflow.step === 'WAITING_RESCHEDULE_CONFIRMATION' &&
      workflow.targetAppointmentId &&
      workflow.holdId
    ) {
      const args = {
        appointmentId: workflow.targetAppointmentId,
        holdId: workflow.holdId,
      };
      const turn = await this.tools.beginTurn({
        conversationId: grant.conversationId,
        actorType: 'AI',
        correlationId: grant.correlationId,
        approvedMutations: [
          { name: 'reschedule_appointment', arguments: args },
        ],
      });
      const result = await this.tools.executeTool(
        {
          name: 'reschedule_appointment',
          arguments: args,
          callId: `sched_${workflow.id}_${workflow.version}_reschedule`,
        },
        turn,
      );
      if (!result.success) {
        this.metric(
          'ai_rescheduling_failed',
          grant,
          workflow,
          result.error?.code,
        );
        return {
          action,
          workflow: serializeWorkflow(await this.repository.reconcile(grant)),
          toolResult: result,
          toolCalls: 1,
        };
      }
      const appointment = schemas.reschedule_appointment.output.parse(
        result.data,
      );
      const completed = await this.repository.complete(
        grant,
        appointment.appointmentId,
      );
      this.metric('ai_rescheduling_completed', grant, completed);
      return {
        action,
        workflow: serializeWorkflow(completed),
        toolResult: result,
        toolCalls: 1,
      };
    }
    if (!workflow.holdId || workflow.step !== 'WAITING_CONFIRMATION')
      return { action, workflow: serializeWorkflow(workflow) };
    const args = { holdId: workflow.holdId };
    const turn = await this.tools.beginTurn({
      conversationId: grant.conversationId,
      actorType: 'AI',
      correlationId: grant.correlationId,
      approvedMutations: [{ name: 'confirm_appointment', arguments: args }],
    });
    const result = await this.tools.executeTool(
      {
        name: 'confirm_appointment',
        arguments: args,
        callId: `sched_${workflow.id}_${workflow.version}_confirm`,
      },
      turn,
    );
    if (!result.success) {
      if (
        result.error?.code === 'HOLD_EXPIRED' ||
        result.error?.code === 'APPOINTMENT_CONFLICT'
      ) {
        this.metric('hold_expired', grant, workflow, result.error.code);
        await this.repository.reconcile(grant);
      }
      return {
        action,
        workflow: serializeWorkflow(await this.repository.reconcile(grant)),
        toolResult: result,
      };
    }
    const appointment = schemas.confirm_appointment.output.parse(result.data);
    const completed = await this.repository.complete(
      grant,
      appointment.appointmentId,
    );
    this.metric('appointment_created', grant, completed);
    return {
      action,
      workflow: serializeWorkflow(completed),
      toolResult: result,
      toolCalls: 1,
    };
  }

  private async change(
    grant: EngineGrant,
    command: SchedulingCommand,
  ): Promise<SchedulingWorkflowResult> {
    await this.releaseCurrent(grant);
    const current = await this.repository.reconcile(grant);
    if (command.patientId) {
      if (current?.targetAppointmentId)
        throw new Error('SCHEDULING_PATIENT_CHANGE_FORBIDDEN');
      const workflow = await this.repository.selectPatient(
        grant,
        command.patientId,
      );
      return { action: command.action, workflow: serializeWorkflow(workflow) };
    }
    if (command.serviceId) {
      if (current?.workflowType !== 'SCHEDULING')
        throw new Error('SCHEDULING_SERVICE_CHANGE_FORBIDDEN');
      const workflow = await this.repository.selectService(grant, {
        serviceId: command.serviceId,
        specialtyId: command.specialtyId,
        providerId: command.providerId,
        unitId: command.unitId,
      });
      return { action: command.action, workflow: serializeWorkflow(workflow) };
    }
    if (command.preferredDate && command.preferredPeriod) {
      const workflow = await this.repository.preferences(
        grant,
        command.preferredDate,
        command.preferredPeriod,
      );
      return { action: command.action, workflow: serializeWorkflow(workflow) };
    }
    throw new Error('SCHEDULING_CHANGE_REQUIRED');
  }

  private async releaseCurrent(grant: EngineGrant) {
    const current = await this.repository.reconcile(grant);
    if (!current?.holdId || current.hold?.status !== 'ACTIVE') return;
    const args = { holdId: current.holdId };
    const turn = await this.tools.beginTurn({
      conversationId: grant.conversationId,
      actorType: 'AI',
      correlationId: grant.correlationId,
      approvedMutations: [{ name: 'release_hold', arguments: args }],
    });
    const result = await this.tools.executeTool(
      {
        name: 'release_hold',
        arguments: args,
        callId: `sched_${current.id}_${current.version}_release`,
      },
      turn,
    );
    if (!result.success && result.error?.code !== 'HOLD_EXPIRED')
      throw new Error('SCHEDULING_RELEASE_FAILED');
    await this.repository.reconcile(grant);
  }

  private metric(
    event: string,
    grant: EngineGrant,
    workflow: SchedulingWorkflowView,
    code?: string,
  ) {
    this.logger.log({
      event,
      tenantId: grant.tenantId,
      conversationId: grant.conversationId,
      workflowId: workflow.id,
      step: workflow.step,
      ...(code ? { code } : {}),
    });
  }
}
