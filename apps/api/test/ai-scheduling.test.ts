import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { periodRange } from '../src/scheduling-workflow/scheduling-workflow.policy';
import { engineOutputSchema } from '../src/conversation-engine/conversation-engine.output';
import { SchedulingWorkflowCoordinator } from '../src/scheduling-workflow/scheduling-workflow.coordinator';
import type { SchedulingWorkflowRepository } from '../src/scheduling-workflow/scheduling-workflow.repository';
import type { ToolGateway } from '../src/tools/tool-gateway.service';

const id = randomUUID;
const grant = {
  tenantId: id(),
  conversationId: id(),
  runId: id(),
  leaseOwnerId: id(),
  correlationId: id(),
};
const command = (action: string, patch: Record<string, unknown> = {}) =>
  engineOutputSchema.parse({
    intent: 'SCHEDULING',
    confidence: 0.99,
    response: null,
    waitingForPatient: false,
    handoffReason: null,
    summary: 'Agendamento em andamento.',
    toolCalls: [],
    scheduling: {
      action,
      patientId: null,
      specialtyId: null,
      serviceId: null,
      providerId: null,
      unitId: null,
      preferredDate: null,
      preferredPeriod: null,
      optionNumber: null,
      ...patch,
    },
  }).scheduling!;

test('períodos são resolvidos no timezone da clínica sem usar timezone do processo', () => {
  assert.deepEqual(periodRange('2026-10-13', 'MORNING', 'America/Sao_Paulo'), {
    startAt: '2026-10-13T09:00:00.000Z',
    endAt: '2026-10-13T15:00:00.000Z',
  });
  const any = periodRange('2026-10-13', 'ANY', 'UTC');
  assert.equal(any.startAt, '2026-10-13T00:00:00.000Z');
  assert.equal(any.endAt, '2026-10-14T00:00:00.000Z');
});

test('schema exige comando estruturado, opção limitada e rejeita tenant vindo da IA', () => {
  assert.equal(command('SELECT_SLOT', { optionNumber: 2 }).optionNumber, 2);
  assert.throws(() => command('SELECT_SLOT', { optionNumber: 6 }));
  assert.throws(() => command('START', { tenantId: id() }));
  assert.throws(() => command('CONFIRM', { appointmentId: id() }));
});

function fixture() {
  const patientId = id();
  let patientSelections = 0;
  const workflow = {
    id: id(),
    tenantId: grant.tenantId,
    conversationId: grant.conversationId,
    contactId: id(),
    workflowType: 'SCHEDULING',
    patientId: patientId as string | null,
    specialtyId: id(),
    serviceId: id(),
    providerId: id(),
    unitId: id(),
    preferredDate: new Date('2035-01-02T12:00:00Z'),
    preferredPeriod: 'MORNING',
    holdId: null as string | null,
    targetAppointmentId: null as string | null,
    appointmentId: null as string | null,
    step: 'SELECT_SLOT',
    version: 3,
    expiresAt: new Date('2035-01-03T00:00:00Z'),
    tenant: { timezone: 'UTC' },
    patient: { name: 'Paciente' } as { name: string } | null,
    specialty: { name: 'Cardiologia' },
    service: { name: 'Consulta', durationMinutes: 30 },
    provider: { name: 'Dra. Ana' },
    unit: {
      name: 'Centro',
      timezoneOverride: null,
      tenant: { timezone: 'UTC' },
    },
    hold: null as { status: string; expiresAt: Date } | null,
    appointment: null as {
      id: string;
      status: string;
      startAt: Date;
      endAt: Date;
    } | null,
    targetAppointment: null,
    appointmentOptions: [],
    options: [
      {
        optionNumber: 2,
        serviceId: id(),
        providerId: id(),
        unitId: id(),
        startAt: new Date('2035-01-02T10:00:00Z'),
        endAt: new Date('2035-01-02T10:30:00Z'),
        timezone: 'UTC',
        expiresAt: new Date('2035-01-02T09:30:00Z'),
        provider: { name: 'Dra. Ana' },
        unit: { name: 'Centro' },
        service: { name: 'Consulta' },
      },
    ],
  };
  const calls: unknown[] = [];
  const repository = {
    load: async () => workflow,
    start: async () => workflow,
    reconcile: async () => workflow,
    selectPatient: async (_grant: unknown, selectedPatientId: string) => {
      patientSelections++;
      workflow.patientId = selectedPatientId;
      workflow.patient = { name: 'Paciente selecionado' };
      workflow.step = 'IDENTIFY_SERVICE';
      return workflow;
    },
    option: async (_grant: unknown, number: number) => ({
      workflow,
      option: { ...workflow.options[0], optionNumber: number },
    }),
    setHold: async (
      _grant: unknown,
      _number: number,
      hold: { holdId: string; expiresAt: string },
    ) => {
      workflow.holdId = hold.holdId;
      workflow.hold = { status: 'ACTIVE', expiresAt: new Date(hold.expiresAt) };
      workflow.step = 'WAITING_CONFIRMATION';
      workflow.version++;
      return workflow;
    },
    complete: async (_grant: unknown, appointmentId: string) => {
      workflow.appointmentId = appointmentId;
      workflow.appointment = {
        id: appointmentId,
        status: 'PENDING_CONFIRMATION',
        startAt: new Date('2035-01-02T10:00:00Z'),
        endAt: new Date('2035-01-02T10:30:00Z'),
      };
      workflow.step = 'COMPLETED';
      return workflow;
    },
  };
  const gateway = {
    beginTurn: async (input: unknown) => {
      calls.push({ begin: input });
      return { id: id() };
    },
    executeTool: async (input: {
      name: string;
      arguments: Record<string, unknown>;
    }) => {
      calls.push(input);
      if (input.name === 'get_contact_context')
        return {
          success: true,
          toolName: input.name,
          callId: 'context',
          data: {
            contactId: workflow.contactId,
            name: 'Contato',
            channel: 'WHATSAPP',
            activePatientId: null,
            patients: [
              {
                patientId: id(),
                name: 'Paciente A',
                relationship: 'SELF',
                status: 'VERIFIED',
                authorizationLevel: 'SCHEDULING_ONLY',
              },
              {
                patientId: id(),
                name: 'Paciente B',
                relationship: 'SON_DAUGHTER',
                status: 'VERIFIED',
                authorizationLevel: 'FULL',
              },
            ],
          },
        };
      if (input.name === 'create_hold')
        return {
          success: true,
          toolName: input.name,
          callId: 'hold',
          data: {
            holdId: id(),
            startAt: '2035-01-02T10:00:00.000Z',
            endAt: '2035-01-02T10:30:00.000Z',
            expiresAt: '2035-01-02T09:55:00.000Z',
            status: 'ACTIVE',
          },
        };
      return {
        success: true,
        toolName: input.name,
        callId: 'confirm',
        data: {
          appointmentId: id(),
          serviceId: workflow.serviceId,
          providerId: workflow.providerId,
          unitId: workflow.unitId,
          startAt: '2035-01-02T10:00:00.000Z',
          endAt: '2035-01-02T10:30:00.000Z',
          status: 'PENDING_CONFIRMATION',
        },
      };
    },
  };
  return {
    workflow,
    calls,
    patientSelections: () => patientSelections,
    coordinator: new SchedulingWorkflowCoordinator(
      repository as unknown as SchedulingWorkflowRepository,
      gateway as unknown as ToolGateway,
    ),
  };
}

test('mais de um paciente autorizado exige escolha explícita', async () => {
  const f = fixture();
  f.workflow.patientId = null;
  f.workflow.patient = null;
  f.workflow.step = 'IDENTIFY_PATIENT';
  const result = await f.coordinator.execute(grant, command('START'));
  assert.equal(f.patientSelections(), 0);
  assert.equal(result.workflow?.step, 'IDENTIFY_PATIENT');
  assert.equal(result.workflow?.patient, null);
});

test('seleção usa o slot persistido e aprova exatamente o create_hold construído pelo backend', async () => {
  const f = fixture();
  await f.coordinator.execute(
    grant,
    command('SELECT_SLOT', { optionNumber: 2 }),
  );
  const call = f.calls.find(
    (value) => (value as { name?: string }).name === 'create_hold',
  ) as { arguments: Record<string, unknown> };
  assert.equal(call.arguments.startAt, '2035-01-02T10:00:00.000Z');
  assert.equal(call.arguments.serviceId, f.workflow.options[0].serviceId);
  const begin = f.calls[0] as {
    begin: { approvedMutations: { arguments: unknown }[] };
  };
  assert.deepEqual(begin.begin.approvedMutations[0].arguments, call.arguments);
  assert.equal(f.workflow.step, 'WAITING_CONFIRMATION');
});

test('confirmação fora de WAITING_CONFIRMATION não chama tool nem cria Appointment', async () => {
  const f = fixture();
  f.workflow.step = 'COLLECT_PREFERENCES';
  f.workflow.holdId = null;
  await f.coordinator.execute(grant, command('CONFIRM'));
  assert.equal(f.calls.length, 0);
  assert.equal(f.workflow.appointmentId, null);
});

test('confirmação contextual aprova hold exato e conclui com resultado real da tool', async () => {
  const f = fixture();
  f.workflow.step = 'WAITING_CONFIRMATION';
  f.workflow.holdId = id();
  f.workflow.hold = {
    status: 'ACTIVE',
    expiresAt: new Date('2035-01-02T09:55:00Z'),
  };
  const result = await f.coordinator.execute(grant, command('CONFIRM'));
  const call = f.calls.find(
    (value) => (value as { name?: string }).name === 'confirm_appointment',
  ) as { arguments: { holdId: string } };
  assert.equal(call.arguments.holdId, f.workflow.holdId);
  assert.equal(result.workflow?.step, 'COMPLETED');
  assert(f.workflow.appointmentId);
});
