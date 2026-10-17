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

test('Cancelamento e remarcação IA E2E: autorização, confirmação, HOLD, atomicidade e isolamento', async (t) => {
  const client = createDatabaseClient(connection);
  const app = await createApplication();
  try {
    const tenant = await client.tenant.create({
      data: {
        name: 'AI appointment changes',
        status: 'ACTIVE',
        timezone: 'UTC',
      },
    });
    const foreignTenant = await client.tenant.create({
      data: {
        name: 'AI appointment changes foreign',
        status: 'ACTIVE',
        timezone: 'UTC',
      },
    });
    const authorizer = await client.user.create({
      data: {
        name: 'Autorizador',
        email: `${randomUUID()}@ai-appointment-changes.test`,
        passwordHash: 'not-used',
        memberships: { create: { tenantId: tenant.id, role: 'CLINIC_ADMIN' } },
      },
    });
    const specialty = await client.specialty.create({
      data: { tenantId: tenant.id, name: 'Clínica médica' },
    });
    const service = await client.service.create({
      data: {
        tenantId: tenant.id,
        specialtyId: specialty.id,
        name: 'Consulta',
        durationMinutes: 30,
      },
    });
    const provider = await client.provider.create({
      data: {
        tenantId: tenant.id,
        name: 'Dra. Ana',
        professionalType: 'DOCTOR',
      },
    });
    const unit = await client.unit.create({
      data: { tenantId: tenant.id, name: 'Centro', address: 'Rua Central' },
    });
    await client.providerService.create({
      data: {
        tenantId: tenant.id,
        providerId: provider.id,
        serviceId: service.id,
      },
    });
    await client.providerUnit.create({
      data: { tenantId: tenant.id, providerId: provider.id, unitId: unit.id },
    });
    for (const weekday of weekdays)
      await client.availabilityRule.create({
        data: {
          tenantId: tenant.id,
          providerId: provider.id,
          unitId: unit.id,
          weekday,
          startTime: localTime('09:00'),
          endTime: localTime('17:00'),
          validFrom: civilDate('2035-01-01'),
          validUntil: civilDate('2035-12-31'),
        },
      });

    const createFlow = async (suffix: string, content: string) => {
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
          content,
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
        repository,
        grant: claimed.grant,
        authorization: await app.resolve(AuthorizationService, contextId, {
          strict: false,
        }),
        coordinator: await app.resolve(
          SchedulingWorkflowCoordinator,
          contextId,
          {
            strict: false,
          },
        ),
      };
    };

    const createAppointment = async (
      flow: Awaited<ReturnType<typeof createFlow>>,
      startAt: string,
      status: 'PENDING_CONFIRMATION' | 'CONFIRMED' = 'CONFIRMED',
    ) => {
      const start = new Date(startAt);
      const end = new Date(+start + 30 * 60 * 1000);
      return client.appointment.create({
        data: {
          tenantId: tenant.id,
          patientId: flow.patient.id,
          contactId: flow.contact.id,
          serviceId: service.id,
          providerId: provider.id,
          unitId: unit.id,
          status,
          startAt: start,
          endAt: end,
          occupiedStartAt: start,
          occupiedEndAt: end,
          source: 'MANUAL',
          createdByType: 'USER',
          createdById: authorizer.id,
        },
      });
    };

    await t.test(
      'cancela apenas a consulta numerada após confirmação explícita e mantém replay idempotente',
      async () => {
        const flow = await createFlow(
          'cancelamento',
          'Quero cancelar minha consulta.',
        );
        const first = await createAppointment(flow, '2035-01-10T10:00:00Z');
        const second = await createAppointment(flow, '2035-01-10T14:00:00Z');
        await flow.authorization.runAsConversationEngine(
          flow.grant,
          async () => {
            const started = await flow.coordinator.execute(
              flow.grant,
              command('START_CANCELLATION', { preferredDate: '2035-01-10' }),
            );
            assert.equal(started.workflow?.type, 'CANCELLATION');
            assert.equal(started.workflow?.step, 'IDENTIFY_APPOINTMENT');
            assert.deepEqual(
              started.workflow?.appointmentOptions.map(
                (option) => option.number,
              ),
              [1, 2],
            );

            const premature = await flow.coordinator.execute(
              flow.grant,
              command('CONFIRM'),
            );
            assert.equal(premature.workflow?.step, 'IDENTIFY_APPOINTMENT');
            assert.equal(
              (
                await client.appointment.findUniqueOrThrow({
                  where: { id: first.id },
                })
              ).status,
              'CONFIRMED',
            );

            const selected = await flow.coordinator.execute(
              flow.grant,
              command('SELECT_APPOINTMENT', { optionNumber: 1 }),
            );
            assert.equal(
              selected.workflow?.step,
              'WAITING_CANCELLATION_CONFIRMATION',
            );
            assert.equal(selected.workflow?.targetAppointment?.id, first.id);

            const confirmed = await flow.coordinator.execute(
              flow.grant,
              command('CONFIRM'),
            );
            assert.equal(confirmed.workflow?.step, 'COMPLETED');
            assert.equal(
              confirmed.workflow?.targetAppointment?.status,
              'CANCELLED',
            );
            const replay = await flow.coordinator.execute(
              flow.grant,
              command('CONFIRM'),
            );
            assert.equal(replay.workflow?.step, 'COMPLETED');
          },
        );

        await flow.repository.complete(
          flow.grant,
          {
            intent: 'CANCELLATION',
            confidence: 0.99,
            response: 'Consulta cancelada.',
            waitingForPatient: false,
            handoffReason: null,
            summary: 'Cancelamento confirmado.',
            scheduling: command('NONE'),
            toolCalls: [],
          },
          3,
        );

        assert.equal(
          (
            await client.appointment.findUniqueOrThrow({
              where: { id: second.id },
            })
          ).status,
          'CONFIRMED',
        );
        const cancellationAudit = await client.authEvent.findFirstOrThrow({where:{resourceId:first.id,type:'APPOINTMENT_CANCELLED'}});
        assert.equal(cancellationAudit.actorType,'AI');
        assert.equal(cancellationAudit.userId,null);
        assert.equal(cancellationAudit.source,'AI_ENGINE');
        assert.equal(cancellationAudit.tenantId,tenant.id);
        assert.ok(cancellationAudit.correlationId);
        assert.deepEqual(cancellationAudit.previousValues,{status:'CONFIRMED'});
        assert.deepEqual(cancellationAudit.newValues,{status:'CANCELLED'});
        assert.equal(
          await client.authEvent.count({
            where: { resourceId: first.id, type: 'APPOINTMENT_CANCELLED' },
          }),
          1,
        );
        assert.equal(
          (
            await client.conversation.findUniqueOrThrow({
              where: { id: flow.conversation.id },
            })
          ).intent,
          'CANCELLATION',
        );
        assert.equal(
          await client.message.count({
            where: { conversationId: flow.conversation.id, senderType: 'AI' },
          }),
          1,
        );
      },
    );

    await t.test(
      'remarca via novo HOLD, preserva a original até confirmar e troca atomicamente',
      async () => {
        const flow = await createFlow(
          'remarcação',
          'Quero remarcar minha consulta.',
        );
        const original = await createAppointment(flow, '2035-01-13T10:00:00Z');
        let expectedStart = '';
        await flow.authorization.runAsConversationEngine(
          flow.grant,
          async () => {
            const started = await flow.coordinator.execute(
              flow.grant,
              command('START_RESCHEDULING', { preferredDate: '2035-01-13' }),
            );
            assert.equal(started.workflow?.type, 'RESCHEDULING');
            assert.equal(started.workflow?.targetAppointment?.id, original.id);
            assert.equal(started.workflow?.step, 'COLLECT_NEW_PREFERENCES');

            await flow.coordinator.execute(
              flow.grant,
              command('SET_PREFERENCES', {
                preferredDate: '2035-01-15',
                preferredPeriod: 'MORNING',
              }),
            );
            const searched = await flow.coordinator.execute(
              flow.grant,
              command('SEARCH_SLOTS'),
            );
            assert.equal(searched.workflow?.step, 'SELECT_NEW_SLOT');
            assert.ok((searched.workflow?.options.length ?? 0) > 0);
            expectedStart = searched.workflow?.options[0]?.startAt ?? '';
            assert.equal(
              (
                await client.appointment.findUniqueOrThrow({
                  where: { id: original.id },
                })
              ).status,
              'CONFIRMED',
            );

            const held = await flow.coordinator.execute(
              flow.grant,
              command('SELECT_SLOT', { optionNumber: 1 }),
            );
            assert.equal(
              held.workflow?.step,
              'WAITING_RESCHEDULE_CONFIRMATION',
            );
            assert.equal(held.workflow?.hold?.status, 'ACTIVE');
            assert.equal(
              (
                await client.appointment.findUniqueOrThrow({
                  where: { id: original.id },
                })
              ).status,
              'CONFIRMED',
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
            await flow.coordinator.execute(flow.grant, command('CONFIRM'));
          },
        );

        await flow.repository.complete(
          flow.grant,
          {
            intent: 'RESCHEDULING',
            confidence: 0.99,
            response: 'Consulta remarcada.',
            waitingForPatient: false,
            handoffReason: null,
            summary: 'Remarcação confirmada.',
            scheduling: command('NONE'),
            toolCalls: [],
          },
          4,
        );

        const old = await client.appointment.findUniqueOrThrow({
          where: { id: original.id },
        });
        const successor = await client.appointment.findFirstOrThrow({
          where: { tenantId: tenant.id, previousAppointmentId: original.id },
          include: { hold: true },
        });
        assert.equal(old.status, 'RESCHEDULED');
        assert.equal(successor.patientId, original.patientId);
        assert.equal(successor.serviceId, original.serviceId);
        assert.equal(successor.contactId, original.contactId);
        assert.equal(successor.source, 'WHATSAPP_AI');
        assert.equal(successor.createdByType, 'AI');
        assert.equal(successor.startAt.toISOString(), expectedStart);
        assert.equal(successor.tenantId, tenant.id);
        assert.equal(successor.hold?.status, 'CONSUMED');
        assert.equal(
          await client.appointment.count({
            where: { previousAppointmentId: original.id },
          }),
          1,
        );
        assert.equal(
          await client.authEvent.count({
            where: { resourceId: original.id, type: 'APPOINTMENT_RESCHEDULED' },
          }),
          1,
        );

        const foreignPatient = await client.patient.create({
          data: {
            tenantId: foreignTenant.id,
            name: 'Paciente externo',
            birthDate: civilDate('2000-01-01'),
          },
        });
        assert.notEqual(foreignPatient.tenantId, tenant.id);
        assert.equal(
          await client.schedulingWorkflow.count({
            where: { tenantId: foreignTenant.id },
          }),
          0,
        );
        assert.equal(
          await client.message.count({
            where: { conversationId: flow.conversation.id, senderType: 'AI' },
          }),
          1,
        );
      },
    );

    await t.test(
      'abandono e HOLD expirado preservam a consulta original',
      async () => {
        for (const mode of ['abandon', 'expire'] as const) {
          const flow = await createFlow(mode, 'Quero mudar meu horário.');
          const original = await createAppointment(
            flow,
            mode === 'abandon'
              ? '2035-02-05T10:00:00Z'
              : '2035-02-06T10:00:00Z',
          );
          let holdId = '';
          await flow.authorization.runAsConversationEngine(
            flow.grant,
            async () => {
              await flow.coordinator.execute(
                flow.grant,
                command('START_RESCHEDULING', {
                  preferredDate:
                    mode === 'abandon' ? '2035-02-05' : '2035-02-06',
                }),
              );
              await flow.coordinator.execute(
                flow.grant,
                command('SET_PREFERENCES', {
                  preferredDate: '2035-02-08',
                  preferredPeriod: 'AFTERNOON',
                }),
              );
              await flow.coordinator.execute(
                flow.grant,
                command('SEARCH_SLOTS'),
              );
              const held = await flow.coordinator.execute(
                flow.grant,
                command('SELECT_SLOT', { optionNumber: 1 }),
              );
              holdId = held.workflow?.hold?.id ?? '';
              if (mode === 'abandon') {
                const abandoned = await flow.coordinator.execute(
                  flow.grant,
                  command('ABANDON'),
                );
                assert.equal(abandoned.workflow?.step, 'ABANDONED');
              } else {
                await client.appointmentHold.update({
                  where: { id: holdId },
                  data: { status: 'EXPIRED' },
                });
                const recovered = await flow.coordinator.execute(
                  flow.grant,
                  command('CONFIRM'),
                );
                assert.equal(recovered.workflow?.step, 'SELECT_NEW_SLOT');
                assert.equal(recovered.workflow?.hold, null);
              }
            },
          );
          assert(holdId);
          assert.equal(
            (
              await client.appointment.findUniqueOrThrow({
                where: { id: original.id },
              })
            ).status,
            'CONFIRMED',
          );
          assert.equal(
            (
              await client.appointmentHold.findUniqueOrThrow({
                where: { id: holdId },
              })
            ).status,
            mode === 'abandon' ? 'RELEASED' : 'EXPIRED',
          );
          assert.equal(
            await client.appointment.count({
              where: { previousAppointmentId: original.id },
            }),
            0,
          );
        }
      },
    );
  } finally {
    await app.close();
    await client.$disconnect();
  }
});
