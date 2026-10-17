import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ContextIdFactory } from '@nestjs/core';
import { createDatabaseClient } from '@atendente/database';
import { createApplication } from '../src/bootstrap';
import { AuthorizationService } from '../src/permissions/authorization.service';
import { ConversationEngineRepository } from '../src/conversation-engine/conversation-engine.repository';
import { SchedulingWorkflowCoordinator } from '../src/scheduling-workflow/scheduling-workflow.coordinator';
import {
  civilDate,
  localTime,
  weekdays,
} from '../src/availability/availability.dto';
import type { ConversationEngineOutput } from '../src/conversation-engine/conversation-engine.output';

const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).pathname !== '/task002_test' ||
  connection !== process.env.DATABASE_URL
)
  throw new Error('Use pnpm db:test.');

const blank = {
  patientId: null,
  specialtyId: null,
  serviceId: null,
  providerId: null,
  unitId: null,
  preferredDate: null,
  preferredPeriod: null,
  optionNumber: null,
};
const command = (
  action: NonNullable<ConversationEngineOutput['scheduling']>['action'],
  patch: Partial<NonNullable<ConversationEngineOutput['scheduling']>> = {},
) => ({ action, ...blank, ...patch });

test('Agendamento IA E2E: SELF, slots reais, HOLD, confirmação, idempotência e tenant', async () => {
  const client = createDatabaseClient(connection);
  const app = await createApplication();
  try {
    const tenant = await client.tenant.create({
      data: { name: 'AI Scheduling', status: 'ACTIVE', timezone: 'UTC' },
    });
    const otherTenant = await client.tenant.create({
      data: { name: 'Isolado', status: 'ACTIVE', timezone: 'UTC' },
    });
    const authorizer = await client.user.create({
      data: {
        name: 'Autorizador',
        email: `${randomUUID()}@ai-scheduling.test`,
        passwordHash: 'not-used',
        memberships: {
          create: { tenantId: tenant.id, role: 'CLINIC_ADMIN' },
        },
      },
    });
    const specialty = await client.specialty.create({
      data: { tenantId: tenant.id, name: 'Cardiologia' },
    });
    const service = await client.service.create({
      data: {
        tenantId: tenant.id,
        specialtyId: specialty.id,
        name: 'Consulta cardiológica',
        durationMinutes: 30,
        bufferBeforeMinutes: 5,
        bufferAfterMinutes: 5,
      },
    });
    const provider = await client.provider.create({
      data: {
        tenantId: tenant.id,
        name: 'Dr. João',
        professionalType: 'DOCTOR',
      },
    });
    const unit = await client.unit.create({
      data: {
        tenantId: tenant.id,
        name: 'Centro',
        address: 'Rua Central',
      },
    });
    await client.providerService.create({
      data: {
        tenantId: tenant.id,
        providerId: provider.id,
        serviceId: service.id,
      },
    });
    await client.providerUnit.create({
      data: {
        tenantId: tenant.id,
        providerId: provider.id,
        unitId: unit.id,
      },
    });
    for (const weekday of weekdays)
      await client.availabilityRule.create({
        data: {
          tenantId: tenant.id,
          providerId: provider.id,
          unitId: unit.id,
          weekday,
          startTime: localTime('09:00'),
          endTime: localTime('12:00'),
          validFrom: civilDate('2035-01-01'),
          validUntil: civilDate('2035-12-31'),
        },
      });
    const foreignPatient = await client.patient.create({
      data: {
        tenantId: otherTenant.id,
        name: 'Paciente de outro tenant',
        birthDate: civilDate('2000-01-01'),
      },
    });

    const createConversation = async (suffix: string) => {
      const contact = await client.contact.create({
        data: { tenantId: tenant.id, displayName: `Contato ${suffix}` },
      });
      const patient = await client.patient.create({
        data: {
          tenantId: tenant.id,
          name: `Paciente ${suffix}`,
          birthDate: civilDate('2000-01-01'),
        },
      });
      await client.contactPatient.create({
        data: {
          tenantId: tenant.id,
          contactId: contact.id,
          patientId: patient.id,
          relationshipType: 'SELF',
          relationshipStatus: 'VERIFIED',
          authorizationLevel: 'SCHEDULING_ONLY',
          authorizedAt: new Date(),
          authorizedBy: authorizer.id,
        },
      });
      const conversation = await client.conversation.create({
        data: { tenantId: tenant.id, contactId: contact.id },
      });
      const message = await client.message.create({
        data: {
          tenantId: tenant.id,
          conversationId: conversation.id,
          channel: 'WHATSAPP',
          senderType: 'PATIENT',
          messageType: 'TEXT',
          content: 'Quero marcar uma consulta.',
        },
      });
      const run = await client.aIProcessingRun.create({
        data: {
          tenantId: tenant.id,
          conversationId: conversation.id,
          inboundMessageId: message.id,
          correlationId: randomUUID(),
        },
      });
      const repository = await app.resolve(
        ConversationEngineRepository,
        undefined,
        {
          strict: false,
        },
      );
      const claimed = await repository.claim(
        {
          tenantId: tenant.id,
          conversationId: conversation.id,
          messageId: message.id,
          runId: run.id,
        },
        randomUUID(),
      );
      assert.equal(claimed.outcome, 'claimed');
      if (claimed.outcome !== 'claimed') throw new Error('claim esperado');
      const contextId = ContextIdFactory.create();
      app.registerRequestByContextId(Object.freeze({}), contextId);
      return {
        contact,
        patient,
        conversation,
        run,
        grant: claimed.grant,
        repository,
        authorization: await app.resolve(AuthorizationService, contextId, {
          strict: false,
        }),
        coordinator: await app.resolve(
          SchedulingWorkflowCoordinator,
          contextId,
          { strict: false },
        ),
      };
    };

    const flow = await createConversation('principal');
    const date = '2035-01-02';
    await flow.authorization.runAsConversationEngine(flow.grant, async () => {
      const started = await flow.coordinator.execute(
        flow.grant,
        command('START'),
      );
      assert.equal(started.workflow?.patient?.id, flow.patient.id);
      assert.equal(started.workflow?.step, 'IDENTIFY_SERVICE');

      await assert.rejects(() =>
        flow.coordinator.execute(
          flow.grant,
          command('SELECT_PATIENT', { patientId: foreignPatient.id }),
        ),
      );

      const selected = await flow.coordinator.execute(
        flow.grant,
        command('SELECT_SERVICE', {
          specialtyId: specialty.id,
          serviceId: service.id,
          providerId: provider.id,
          unitId: unit.id,
        }),
      );
      assert.equal(selected.workflow?.step, 'COLLECT_PREFERENCES');
      await flow.coordinator.execute(
        flow.grant,
        command('SET_PREFERENCES', {
          preferredDate: date,
          preferredPeriod: 'MORNING',
        }),
      );
      const searched = await flow.coordinator.execute(
        flow.grant,
        command('SEARCH_SLOTS'),
      );
      assert.equal(searched.workflow?.step, 'SELECT_SLOT');
      assert.equal(searched.workflow?.options.length, 5);
      assert.equal(
        searched.workflow?.options[0]?.startAt,
        '2035-01-02T09:15:00.000Z',
      );

      const held = await flow.coordinator.execute(
        flow.grant,
        command('SELECT_SLOT', { optionNumber: 1 }),
      );
      assert.equal(held.workflow?.step, 'WAITING_CONFIRMATION');
      assert.equal(held.workflow?.hold?.status, 'ACTIVE');
      assert.equal(
        await client.appointment.count({
          where: { tenantId: tenant.id, patientId: flow.patient.id },
        }),
        0,
      );

      const confirmed = await flow.coordinator.execute(
        flow.grant,
        command('CONFIRM'),
      );
      assert.equal(confirmed.workflow?.step, 'COMPLETED');
      assert.equal(
        confirmed.workflow?.appointment?.status,
        'PENDING_CONFIRMATION',
      );
    });

    const appointment = await client.appointment.findFirstOrThrow({
      where: {
        tenantId: tenant.id,
        patientId: flow.patient.id,
        serviceId: service.id,
      },
      include: { hold: true },
    });
    assert.equal(appointment.providerId, provider.id);
    assert.equal(appointment.unitId, unit.id);
    assert.equal(appointment.source, 'WHATSAPP_AI');
    assert.equal(appointment.createdByType, 'AI');
    assert.equal(appointment.createdById, null);
    assert.equal(appointment.hold?.status, 'CONSUMED');
    assert.equal(
      await client.appointment.count({ where: { holdId: appointment.holdId } }),
      1,
    );

    await flow.repository.complete(
      flow.grant,
      {
        intent: 'SCHEDULING',
        confidence: 0.99,
        response: 'Consulta agendada com sucesso.',
        waitingForPatient: false,
        handoffReason: null,
        summary: 'Consulta cardiológica criada.',
        scheduling: command('NONE'),
        toolCalls: [],
      },
      3,
    );
    assert.equal(
      await client.message.count({
        where: {
          tenantId: tenant.id,
          conversationId: flow.conversation.id,
          senderType: 'AI',
        },
      }),
      1,
    );
    assert.equal(
      (
        await client.conversation.findUniqueOrThrow({
          where: { id: flow.conversation.id },
        })
      ).intent,
      'SCHEDULING',
    );
    assert.equal(
      await client.schedulingWorkflow.count({
        where: { tenantId: otherTenant.id },
      }),
      0,
    );

    const recovery = await createConversation('recuperação');
    let expiredHoldId = '';
    await recovery.authorization.runAsConversationEngine(
      recovery.grant,
      async () => {
        await recovery.coordinator.execute(recovery.grant, command('START'));
        await recovery.coordinator.execute(
          recovery.grant,
          command('SELECT_SERVICE', {
            specialtyId: specialty.id,
            serviceId: service.id,
            providerId: provider.id,
            unitId: unit.id,
          }),
        );
        await recovery.coordinator.execute(
          recovery.grant,
          command('SET_PREFERENCES', {
            preferredDate: date,
            preferredPeriod: 'MORNING',
          }),
        );
        await recovery.coordinator.execute(
          recovery.grant,
          command('SEARCH_SLOTS'),
        );
        const held = await recovery.coordinator.execute(
          recovery.grant,
          command('SELECT_SLOT', { optionNumber: 2 }),
        );
        expiredHoldId = held.workflow?.hold?.id ?? '';
      },
    );
    assert(expiredHoldId);
    await client.appointmentHold.update({
      where: { id: expiredHoldId },
      data: { status: 'EXPIRED' },
    });

    const recoveredContextId = ContextIdFactory.create();
    app.registerRequestByContextId(Object.freeze({}), recoveredContextId);
    const recoveredAuthorization = await app.resolve(
      AuthorizationService,
      recoveredContextId,
      { strict: false },
    );
    const recoveredCoordinator = await app.resolve(
      SchedulingWorkflowCoordinator,
      recoveredContextId,
      { strict: false },
    );
    await recoveredAuthorization.runAsConversationEngine(
      recovery.grant,
      async () => {
        const recovered = await recoveredCoordinator.execute(
          recovery.grant,
          command('CONFIRM'),
        );
        assert.equal(recovered.workflow?.step, 'SELECT_SLOT');
        assert.equal(recovered.workflow?.hold, null);
      },
    );
    assert.equal(
      await client.appointment.count({
        where: { tenantId: tenant.id, patientId: recovery.patient.id },
      }),
      0,
    );
  } finally {
    await app.close();
    await client.$disconnect();
  }
});
