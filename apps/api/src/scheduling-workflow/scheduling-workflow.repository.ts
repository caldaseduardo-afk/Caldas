import { recordAudit } from '@atendente/database';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { databaseNow, type Prisma } from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import type { EngineGrant } from '../conversation-engine/conversation-engine.repository';
import { ConversationEngineConfig } from '../conversation-engine/conversation-engine.config';
import {
  isPastCivilDate,
  periodRange,
  type SchedulingPeriodName,
} from './scheduling-workflow.policy';

const terminalSteps = ['COMPLETED', 'ABANDONED', 'FAILED', 'EXPIRED'] as const;

const view = {
  id: true,
  tenantId: true,
  conversationId: true,
  contactId: true,
  workflowType: true,
  patientId: true,
  specialtyId: true,
  serviceId: true,
  providerId: true,
  unitId: true,
  preferredDate: true,
  preferredPeriod: true,
  holdId: true,
  targetAppointmentId: true,
  appointmentId: true,
  step: true,
  version: true,
  expiresAt: true,
  tenant: { select: { timezone: true } },
  patient: { select: { name: true } },
  specialty: { select: { name: true } },
  service: { select: { name: true, durationMinutes: true } },
  provider: { select: { name: true } },
  unit: {
    select: {
      name: true,
      timezoneOverride: true,
      tenant: { select: { timezone: true } },
    },
  },
  hold: { select: { status: true, expiresAt: true } },
  appointment: {
    select: { id: true, status: true, startAt: true, endAt: true },
  },
  targetAppointment: {
    select: {
      id: true,
      status: true,
      startAt: true,
      endAt: true,
      patient: { select: { name: true } },
      service: { select: { name: true } },
      provider: { select: { name: true } },
      unit: { select: { name: true } },
      nextAppointment: {
        select: { id: true, status: true, startAt: true, endAt: true },
      },
    },
  },
  options: {
    select: {
      optionNumber: true,
      serviceId: true,
      providerId: true,
      unitId: true,
      startAt: true,
      endAt: true,
      timezone: true,
      expiresAt: true,
      provider: { select: { name: true } },
      unit: { select: { name: true } },
      service: { select: { name: true } },
    },
    orderBy: { optionNumber: 'asc' as const },
  },
  appointmentOptions: {
    select: {
      optionNumber: true,
      appointmentId: true,
      expiresAt: true,
      appointment: {
        select: {
          status: true,
          startAt: true,
          endAt: true,
          service: { select: { name: true } },
          provider: { select: { name: true } },
          unit: { select: { name: true } },
        },
      },
    },
    orderBy: { optionNumber: 'asc' as const },
  },
} satisfies Prisma.SchedulingWorkflowSelect;

export type SchedulingWorkflowView = Prisma.SchedulingWorkflowGetPayload<{
  select: typeof view;
}>;

export interface PersistedSlot {
  serviceId: string;
  providerId: string;
  unitId: string;
  startAt: string;
  endAt: string;
  timezone: string;
}

export interface PersistedAppointment {
  appointmentId: string;
  serviceId: string;
  providerId: string;
  unitId: string;
  startAt: string;
  endAt: string;
  status: 'PENDING_CONFIRMATION' | 'CONFIRMED';
}

@Injectable()
export class SchedulingWorkflowRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConversationEngineConfig,
  ) {}

  private expires(now: Date) {
    return new Date(+now + this.config.workflowTtlHours * 60 * 60 * 1000);
  }

  private async grant(
    tx: Prisma.TransactionClient,
    grant: EngineGrant,
    allowHandoff = false,
  ) {
    const now = await databaseNow(tx);
    const run = await tx.aIProcessingRun.findFirst({
      where: {
        id: grant.runId,
        tenantId: grant.tenantId,
        conversationId: grant.conversationId,
        status: 'PROCESSING',
        conversation: {
          status: allowHandoff
            ? { in: ['AI_ACTIVE', 'NEEDS_HUMAN'] }
            : 'AI_ACTIVE',
          engineLease: {
            ownerId: grant.leaseOwnerId,
            expiresAt: { gt: now },
          },
        },
      },
      select: { conversation: { select: { contactId: true } } },
    });
    if (!run) throw new ConflictException('Turno de conversa inválido.');
    return { now, contactId: run.conversation.contactId };
  }

  private async transaction<T>(
    run: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.database.client.$transaction(run, {
          isolationLevel: 'Serializable',
        });
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : '';
        if (['P2034', 'P2002'].includes(code) && attempt < 2) continue;
        throw error;
      }
    }
  }

  async load(grant: EngineGrant) {
    return this.database.client.schedulingWorkflow.findFirst({
      where: {
        tenantId: grant.tenantId,
        conversationId: grant.conversationId,
        conversation: {
          engineLease: {
            ownerId: grant.leaseOwnerId,
            expiresAt: { gt: new Date() },
          },
        },
      },
      select: view,
    });
  }

  async start(
    grant: EngineGrant,
    workflowType: 'SCHEDULING' | 'CANCELLATION' | 'RESCHEDULING' = 'SCHEDULING',
  ): Promise<SchedulingWorkflowView> {
    return this.transaction(async (tx) => {
      const { now, contactId } = await this.grant(tx, grant);
      const current = await tx.schedulingWorkflow.findUnique({
        where: {
          tenantId_conversationId: {
            tenantId: grant.tenantId,
            conversationId: grant.conversationId,
          },
        },
        select: view,
      });
      if (
        current &&
        current.workflowType === workflowType &&
        !terminalSteps.includes(current.step as (typeof terminalSteps)[number])
      )
        return current;
      if (current) {
        await tx.schedulingSlotOption.deleteMany({
          where: { tenantId: grant.tenantId, workflowId: current.id },
        });
        await tx.schedulingAppointmentOption.deleteMany({
          where: { tenantId: grant.tenantId, workflowId: current.id },
        });
      }
      const row = current
        ? await tx.schedulingWorkflow.update({
            where: { id: current.id },
            data: {
              workflowType,
              patientId: null,
              specialtyId: null,
              serviceId: null,
              providerId: null,
              unitId: null,
              preferredDate: null,
              preferredPeriod: null,
              holdId: null,
              targetAppointmentId: null,
              appointmentId: null,
              step: 'IDENTIFY_PATIENT',
              version: { increment: 1 },
              expiresAt: this.expires(now),
            },
            select: view,
          })
        : await tx.schedulingWorkflow.create({
            data: {
              tenantId: grant.tenantId,
              conversationId: grant.conversationId,
              contactId,
              workflowType,
              expiresAt: this.expires(now),
            },
            select: view,
          });
      await tx.conversation.update({
        where: {
          tenantId_id: {
            tenantId: grant.tenantId,
            id: grant.conversationId,
          },
        },
        data: { intent: workflowType },
      });
      await recordAudit(tx, {
        data: {
          tenantId: grant.tenantId,
          resourceId: row.id,
          type: 'SCHEDULING_WORKFLOW_STARTED',
          changes: { conversationId: grant.conversationId, workflowType },
        },
      });
      return row;
    });
  }

  async reconcile(grant: EngineGrant): Promise<SchedulingWorkflowView | null> {
    return this.transaction(async (tx) => {
      const { now } = await this.grant(tx, grant);
      const current = await tx.schedulingWorkflow.findUnique({
        where: {
          tenantId_conversationId: {
            tenantId: grant.tenantId,
            conversationId: grant.conversationId,
          },
        },
        select: view,
      });
      if (
        !current ||
        terminalSteps.includes(current.step as (typeof terminalSteps)[number])
      )
        return current;
      if (current.appointmentId)
        return tx.schedulingWorkflow.update({
          where: { id: current.id },
          data: { step: 'COMPLETED' },
          select: view,
        });
      if (
        current.workflowType === 'CANCELLATION' &&
        current.targetAppointment?.status === 'CANCELLED'
      )
        return tx.schedulingWorkflow.update({
          where: { id: current.id },
          data: { step: 'COMPLETED', version: { increment: 1 } },
          select: view,
        });
      if (
        current.workflowType === 'RESCHEDULING' &&
        current.targetAppointment?.status === 'RESCHEDULED' &&
        current.targetAppointment.nextAppointment
      )
        return tx.schedulingWorkflow.update({
          where: { id: current.id },
          data: {
            appointmentId: current.targetAppointment.nextAppointment.id,
            step: 'COMPLETED',
            version: { increment: 1 },
          },
          select: view,
        });
      if (current.holdId) {
        const hold = await tx.appointmentHold.findFirst({
          where: { id: current.holdId, tenantId: grant.tenantId },
          select: {
            status: true,
            expiresAt: true,
            appointment: { select: { id: true } },
          },
        });
        if (hold?.appointment)
          return tx.schedulingWorkflow.update({
            where: { id: current.id },
            data: {
              appointmentId: hold.appointment.id,
              step: 'COMPLETED',
              version: { increment: 1 },
            },
            select: view,
          });
        if (hold?.status === 'ACTIVE' && hold.expiresAt > now) {
          const waitingStep =
            current.workflowType === 'RESCHEDULING'
              ? 'WAITING_RESCHEDULE_CONFIRMATION'
              : 'WAITING_CONFIRMATION';
          return current.step === waitingStep
            ? current
            : tx.schedulingWorkflow.update({
                where: { id: current.id },
                data: { step: waitingStep },
                select: view,
              });
        }
        const hasOptions = current.options.some(
          (option) => option.expiresAt > now,
        );
        return tx.schedulingWorkflow.update({
          where: { id: current.id },
          data: {
            holdId: null,
            step:
              current.workflowType === 'RESCHEDULING'
                ? hasOptions
                  ? 'SELECT_NEW_SLOT'
                  : 'SEARCH_NEW_SLOTS'
                : hasOptions
                  ? 'SELECT_SLOT'
                  : 'SEARCH_SLOTS',
            version: { increment: 1 },
          },
          select: view,
        });
      }
      if (current.expiresAt <= now)
        return tx.schedulingWorkflow.update({
          where: { id: current.id },
          data: { step: 'EXPIRED', version: { increment: 1 } },
          select: view,
        });
      return current;
    });
  }

  async selectPatient(grant: EngineGrant, patientId: string) {
    return this.transaction(async (tx) => {
      const { now, contactId } = await this.grant(tx, grant);
      const link = await tx.contactPatient.findFirst({
        where: {
          tenantId: grant.tenantId,
          contactId,
          patientId,
          active: true,
          relationshipStatus: 'VERIFIED',
          authorizationLevel: { in: ['FULL', 'SCHEDULING_ONLY'] },
          patient: { tenantId: grant.tenantId },
        },
        select: { id: true },
      });
      if (!link)
        throw new NotFoundException('Paciente autorizado não encontrado.');
      const workflow = await this.requireWorkflow(tx, grant);
      await tx.schedulingSlotOption.deleteMany({
        where: { tenantId: grant.tenantId, workflowId: workflow.id },
      });
      await tx.schedulingAppointmentOption.deleteMany({
        where: { tenantId: grant.tenantId, workflowId: workflow.id },
      });
      await tx.conversation.update({
        where: {
          tenantId_id: { tenantId: grant.tenantId, id: grant.conversationId },
        },
        data: { activePatientId: patientId, intent: workflow.workflowType },
      });
      return tx.schedulingWorkflow.update({
        where: { id: workflow.id },
        data: {
          patientId,
          specialtyId: null,
          serviceId: null,
          providerId: null,
          unitId: null,
          preferredDate: null,
          preferredPeriod: null,
          holdId: null,
          targetAppointmentId: null,
          appointmentId: null,
          step:
            workflow.workflowType === 'SCHEDULING'
              ? 'IDENTIFY_SERVICE'
              : 'IDENTIFY_APPOINTMENT',
          version: { increment: 1 },
          expiresAt: this.expires(now),
        },
        select: view,
      });
    });
  }

  async saveAppointmentOptions(
    grant: EngineGrant,
    appointments: PersistedAppointment[],
  ) {
    return this.transaction(async (tx) => {
      const { now } = await this.grant(tx, grant);
      const workflow = await this.requireWorkflow(tx, grant);
      if (
        workflow.workflowType === 'SCHEDULING' ||
        !workflow.patientId ||
        workflow.step !== 'IDENTIFY_APPOINTMENT'
      )
        throw new ConflictException('Fluxo não aguarda consulta.');
      const selected = appointments.slice(0, 5);
      const rows = await tx.appointment.findMany({
        where: {
          tenantId: grant.tenantId,
          id: { in: selected.map((item) => item.appointmentId) },
          patientId: workflow.patientId,
          contactId: workflow.contactId,
          status: { in: ['PENDING_CONFIRMATION', 'CONFIRMED'] },
          startAt: { gt: now },
          nextAppointment: null,
        },
        select: { id: true },
      });
      if (rows.length !== selected.length)
        throw new ConflictException('Lista de consultas inconsistente.');
      await tx.schedulingAppointmentOption.deleteMany({
        where: { tenantId: grant.tenantId, workflowId: workflow.id },
      });
      const optionExpiry = new Date(
        +now + this.config.slotOptionTtlMinutes * 60 * 1000,
      );
      if (selected.length)
        await tx.schedulingAppointmentOption.createMany({
          data: selected.map((item, index) => ({
            tenantId: grant.tenantId,
            workflowId: workflow.id,
            optionNumber: index + 1,
            appointmentId: item.appointmentId,
            expiresAt: optionExpiry,
          })),
        });
      return tx.schedulingWorkflow.update({
        where: { id: workflow.id },
        data: {
          version: { increment: 1 },
          expiresAt: this.expires(now),
        },
        select: view,
      });
    });
  }

  async appointmentSearchArguments(
    grant: EngineGrant,
    filters: { date?: string | null; serviceId?: string | null },
  ) {
    const workflow = await this.reconcile(grant);
    if (!workflow?.patientId || workflow.workflowType === 'SCHEDULING')
      throw new ConflictException('Paciente não selecionado.');
    const range = filters.date
      ? periodRange(filters.date, 'ANY', workflow.tenant.timezone)
      : {};
    return {
      workflow,
      arguments: {
        ...range,
        ...(filters.serviceId ? { serviceId: filters.serviceId } : {}),
        limit: 5,
      },
    };
  }

  async selectAppointment(grant: EngineGrant, optionNumber: number) {
    return this.transaction(async (tx) => {
      const { now } = await this.grant(tx, grant);
      const workflow = await this.requireWorkflow(tx, grant);
      if (
        workflow.workflowType === 'SCHEDULING' ||
        !workflow.patientId ||
        workflow.step !== 'IDENTIFY_APPOINTMENT'
      )
        throw new ConflictException('Fluxo não aguarda consulta.');
      const option = await tx.schedulingAppointmentOption.findFirst({
        where: {
          tenantId: grant.tenantId,
          workflowId: workflow.id,
          optionNumber,
          expiresAt: { gt: now },
        },
        select: { appointmentId: true },
      });
      if (!option)
        throw new ConflictException('Opção expirada ou inexistente.');
      const appointment = await tx.appointment.findFirst({
        where: {
          id: option.appointmentId,
          tenantId: grant.tenantId,
          patientId: workflow.patientId,
          contactId: workflow.contactId,
          status: { in: ['PENDING_CONFIRMATION', 'CONFIRMED'] },
          startAt: { gt: now },
          nextAppointment: null,
        },
        select: {
          id: true,
          serviceId: true,
          providerId: true,
          unitId: true,
          service: { select: { specialtyId: true } },
        },
      });
      if (!appointment)
        throw new ConflictException('Consulta não está mais disponível.');
      return tx.schedulingWorkflow.update({
        where: { id: workflow.id },
        data: {
          targetAppointmentId: appointment.id,
          specialtyId: appointment.service.specialtyId,
          serviceId: appointment.serviceId,
          providerId: appointment.providerId,
          unitId: appointment.unitId,
          preferredDate: null,
          preferredPeriod: null,
          holdId: null,
          appointmentId: null,
          step:
            workflow.workflowType === 'CANCELLATION'
              ? 'WAITING_CANCELLATION_CONFIRMATION'
              : 'COLLECT_NEW_PREFERENCES',
          version: { increment: 1 },
          expiresAt: this.expires(now),
        },
        select: view,
      });
    });
  }

  async selectService(
    grant: EngineGrant,
    input: {
      serviceId: string;
      specialtyId?: string | null;
      providerId?: string | null;
      unitId?: string | null;
    },
  ) {
    return this.transaction(async (tx) => {
      const { now } = await this.grant(tx, grant);
      const workflow = await this.requireWorkflow(tx, grant);
      if (!workflow.patientId)
        throw new ConflictException('Paciente não selecionado.');
      const service = await tx.service.findFirst({
        where: {
          id: input.serviceId,
          tenantId: grant.tenantId,
          active: true,
          specialty: { active: true },
          ...(input.specialtyId ? { specialtyId: input.specialtyId } : {}),
        },
        select: { specialtyId: true },
      });
      if (!service) throw new NotFoundException('Serviço não encontrado.');
      if (input.providerId) {
        const providerService = await tx.providerService.findFirst({
          where: {
            tenantId: grant.tenantId,
            providerId: input.providerId,
            serviceId: input.serviceId,
            active: true,
            provider: { active: true },
          },
          select: { id: true },
        });
        if (!providerService)
          throw new NotFoundException('Profissional não encontrado.');
      }
      if (input.unitId) {
        const unit = await tx.unit.findFirst({
          where: { id: input.unitId, tenantId: grant.tenantId, active: true },
          select: { id: true },
        });
        if (!unit) throw new NotFoundException('Unidade não encontrada.');
      }
      if (input.providerId && input.unitId) {
        const binding = await tx.providerUnit.findFirst({
          where: {
            tenantId: grant.tenantId,
            providerId: input.providerId,
            unitId: input.unitId,
            active: true,
          },
          select: { id: true },
        });
        if (!binding)
          throw new NotFoundException('Vínculo de agenda não encontrado.');
      }
      await tx.schedulingSlotOption.deleteMany({
        where: { tenantId: grant.tenantId, workflowId: workflow.id },
      });
      return tx.schedulingWorkflow.update({
        where: { id: workflow.id },
        data: {
          specialtyId: service.specialtyId,
          serviceId: input.serviceId,
          providerId: input.providerId ?? null,
          unitId: input.unitId ?? null,
          preferredDate: null,
          preferredPeriod: null,
          holdId: null,
          appointmentId: null,
          step: 'COLLECT_PREFERENCES',
          version: { increment: 1 },
          expiresAt: this.expires(now),
        },
        select: view,
      });
    });
  }

  async preferences(
    grant: EngineGrant,
    date: string,
    period: SchedulingPeriodName,
  ) {
    return this.transaction(async (tx) => {
      const { now } = await this.grant(tx, grant);
      const workflow = await this.requireWorkflow(tx, grant);
      if (
        !workflow.patientId ||
        !workflow.serviceId ||
        (workflow.workflowType === 'RESCHEDULING' &&
          !workflow.targetAppointmentId)
      )
        throw new ConflictException('Contexto de agendamento incompleto.');
      const timezone =
        workflow.unit?.timezoneOverride ??
        workflow.unit?.tenant.timezone ??
        (
          await tx.tenant.findUniqueOrThrow({
            where: { id: grant.tenantId },
            select: { timezone: true },
          })
        ).timezone;
      periodRange(date, period, timezone);
      if (isPastCivilDate(date, timezone, now))
        throw new BadRequestException('A data preferida já passou.');
      await tx.schedulingSlotOption.deleteMany({
        where: { tenantId: grant.tenantId, workflowId: workflow.id },
      });
      return tx.schedulingWorkflow.update({
        where: { id: workflow.id },
        data: {
          preferredDate: new Date(`${date}T12:00:00Z`),
          preferredPeriod: period,
          holdId: null,
          step:
            workflow.workflowType === 'RESCHEDULING'
              ? 'SEARCH_NEW_SLOTS'
              : 'SEARCH_SLOTS',
          version: { increment: 1 },
          expiresAt: this.expires(now),
        },
        select: view,
      });
    });
  }

  async searchArguments(grant: EngineGrant) {
    const workflow = await this.reconcile(grant);
    if (
      !workflow?.serviceId ||
      !workflow.preferredDate ||
      !workflow.preferredPeriod
    )
      throw new ConflictException('Preferências incompletas.');
    const timezone =
      workflow.unit?.timezoneOverride ??
      workflow.unit?.tenant.timezone ??
      workflow.tenant.timezone;
    const date = workflow.preferredDate.toISOString().slice(0, 10);
    return {
      workflow,
      arguments: {
        serviceId: workflow.serviceId,
        ...(workflow.providerId ? { providerId: workflow.providerId } : {}),
        ...(workflow.unitId ? { unitId: workflow.unitId } : {}),
        ...periodRange(date, workflow.preferredPeriod, timezone),
        limit: 5,
      },
    };
  }

  async saveOptions(grant: EngineGrant, slots: PersistedSlot[]) {
    return this.transaction(async (tx) => {
      const { now } = await this.grant(tx, grant);
      const workflow = await this.requireWorkflow(tx, grant);
      if (!workflow.serviceId)
        throw new ConflictException('Serviço não selecionado.');
      const selected = slots.slice(0, 5);
      if (selected.some((slot) => slot.serviceId !== workflow.serviceId))
        throw new ConflictException('Resultado de agenda inconsistente.');
      await tx.schedulingSlotOption.deleteMany({
        where: { tenantId: grant.tenantId, workflowId: workflow.id },
      });
      const optionExpiry = new Date(
        +now + this.config.slotOptionTtlMinutes * 60 * 1000,
      );
      if (selected.length)
        await tx.schedulingSlotOption.createMany({
          data: selected.map((slot, index) => ({
            tenantId: grant.tenantId,
            workflowId: workflow.id,
            optionNumber: index + 1,
            serviceId: slot.serviceId,
            providerId: slot.providerId,
            unitId: slot.unitId,
            startAt: new Date(slot.startAt),
            endAt: new Date(slot.endAt),
            timezone: slot.timezone,
            expiresAt: optionExpiry,
          })),
        });
      return tx.schedulingWorkflow.update({
        where: { id: workflow.id },
        data: {
          step: selected.length
            ? workflow.workflowType === 'RESCHEDULING'
              ? 'SELECT_NEW_SLOT'
              : 'SELECT_SLOT'
            : workflow.workflowType === 'RESCHEDULING'
              ? 'COLLECT_NEW_PREFERENCES'
              : 'COLLECT_PREFERENCES',
          version: { increment: 1 },
          expiresAt: this.expires(now),
        },
        select: view,
      });
    });
  }

  async option(grant: EngineGrant, optionNumber: number) {
    const workflow = await this.reconcile(grant);
    if (
      !workflow ||
      !['SELECT_SLOT', 'SELECT_NEW_SLOT'].includes(workflow.step)
    )
      throw new ConflictException('Não há opções aguardando seleção.');
    const option = workflow.options.find(
      (candidate) => candidate.optionNumber === optionNumber,
    );
    if (!option || option.expiresAt <= new Date())
      throw new ConflictException('Opção expirada ou inexistente.');
    return { workflow, option };
  }

  async setHold(
    grant: EngineGrant,
    optionNumber: number,
    hold: { holdId: string; expiresAt: string },
  ) {
    return this.transaction(async (tx) => {
      const { now } = await this.grant(tx, grant);
      const workflow = await this.requireWorkflow(tx, grant);
      const option = await tx.schedulingSlotOption.findFirst({
        where: {
          tenantId: grant.tenantId,
          workflowId: workflow.id,
          optionNumber,
          expiresAt: { gt: now },
        },
      });
      if (!option)
        throw new ConflictException('Opção expirada ou inexistente.');
      if (
        workflow.workflowType === 'RESCHEDULING' &&
        workflow.targetAppointment &&
        +option.startAt === +workflow.targetAppointment.startAt &&
        +option.endAt === +workflow.targetAppointment.endAt
      )
        throw new ConflictException('A consulta já está nesse horário.');
      const realHold = await tx.appointmentHold.findFirst({
        where: {
          id: hold.holdId,
          tenantId: grant.tenantId,
          patientId: workflow.patientId ?? '',
          serviceId: option.serviceId,
          providerId: option.providerId,
          unitId: option.unitId,
          startAt: option.startAt,
          status: 'ACTIVE',
        },
        select: { id: true, expiresAt: true },
      });
      if (!realHold) throw new ConflictException('HOLD inconsistente.');
      return tx.schedulingWorkflow.update({
        where: { id: workflow.id },
        data: {
          providerId: option.providerId,
          unitId: option.unitId,
          holdId: realHold.id,
          step:
            workflow.workflowType === 'RESCHEDULING'
              ? 'WAITING_RESCHEDULE_CONFIRMATION'
              : 'WAITING_CONFIRMATION',
          version: { increment: 1 },
          expiresAt: this.expires(now),
        },
        select: view,
      });
    });
  }

  async complete(grant: EngineGrant, appointmentId: string) {
    return this.transaction(async (tx) => {
      await this.grant(tx, grant);
      const workflow = await this.requireWorkflow(tx, grant);
      if (workflow.workflowType === 'CANCELLATION')
        throw new ConflictException('Fluxo de cancelamento inválido.');
      const appointment = await tx.appointment.findFirst({
        where: {
          id: appointmentId,
          tenantId: grant.tenantId,
          holdId: workflow.holdId,
          patientId: workflow.patientId ?? '',
          serviceId: workflow.serviceId ?? '',
        },
        select: { id: true },
      });
      if (!appointment) throw new ConflictException('Consulta inconsistente.');
      const row = await tx.schedulingWorkflow.update({
        where: { id: workflow.id },
        data: {
          appointmentId,
          step: 'COMPLETED',
          version: { increment: 1 },
        },
        select: view,
      });
      await recordAudit(tx, {
        data: {
          tenantId: grant.tenantId,
          resourceId: workflow.id,
          type: 'SCHEDULING_WORKFLOW_COMPLETED',
          changes: { conversationId: grant.conversationId, appointmentId },
        },
      });
      return row;
    });
  }

  async completeCancellation(grant: EngineGrant, appointmentId: string) {
    return this.transaction(async (tx) => {
      await this.grant(tx, grant);
      const workflow = await this.requireWorkflow(tx, grant);
      if (
        workflow.workflowType !== 'CANCELLATION' ||
        workflow.targetAppointmentId !== appointmentId
      )
        throw new ConflictException('Consulta de cancelamento inconsistente.');
      const appointment = await tx.appointment.findFirst({
        where: {
          id: appointmentId,
          tenantId: grant.tenantId,
          patientId: workflow.patientId ?? '',
          contactId: workflow.contactId,
          status: 'CANCELLED',
        },
        select: { id: true },
      });
      if (!appointment)
        throw new ConflictException('Cancelamento não concluído.');
      const row = await tx.schedulingWorkflow.update({
        where: { id: workflow.id },
        data: { step: 'COMPLETED', version: { increment: 1 } },
        select: view,
      });
      await recordAudit(tx, {
        data: {
          tenantId: grant.tenantId,
          resourceId: workflow.id,
          type: 'SCHEDULING_WORKFLOW_COMPLETED',
          changes: {
            conversationId: grant.conversationId,
            workflowType: workflow.workflowType,
            targetAppointmentId: appointmentId,
          },
        },
      });
      return row;
    });
  }

  async abandon(grant: EngineGrant, handoff = false) {
    return this.transaction(async (tx) => {
      await this.grant(tx, grant, handoff);
      const workflow = await this.requireWorkflow(tx, grant);
      const step = handoff ? 'NEEDS_HUMAN' : 'ABANDONED';
      const row = await tx.schedulingWorkflow.update({
        where: { id: workflow.id },
        data: { step, version: { increment: 1 } },
        select: view,
      });
      await recordAudit(tx, {
        data: {
          tenantId: grant.tenantId,
          resourceId: workflow.id,
          type: handoff
            ? 'SCHEDULING_WORKFLOW_HANDOFF'
            : 'SCHEDULING_WORKFLOW_ABANDONED',
          changes: { conversationId: grant.conversationId },
        },
      });
      return row;
    });
  }

  private async requireWorkflow(
    tx: Prisma.TransactionClient,
    grant: EngineGrant,
  ) {
    const workflow = await tx.schedulingWorkflow.findUnique({
      where: {
        tenantId_conversationId: {
          tenantId: grant.tenantId,
          conversationId: grant.conversationId,
        },
      },
      select: view,
    });
    if (!workflow) throw new NotFoundException('Fluxo não encontrado.');
    return workflow;
  }

  async expireDue() {
    const now = await databaseNow(this.database.client);
    return this.database.client.schedulingWorkflow.updateMany({
      where: {
        expiresAt: { lte: now },
        step: {
          notIn: ['COMPLETED', 'ABANDONED', 'FAILED', 'NEEDS_HUMAN', 'EXPIRED'],
        },
        OR: [
          { holdId: null },
          { hold: { is: { status: { not: 'ACTIVE' } } } },
          { hold: { is: { expiresAt: { lte: now } } } },
        ],
      },
      data: { step: 'EXPIRED', version: { increment: 1 } },
    });
  }
}
