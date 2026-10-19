import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { MessagingProvider } from '@atendente/domain';
import {
  createDatabaseClient,
  createNotificationQueue,
  deliverMessage,
  dispatchNotificationJobs,
  notificationPayloadFromAttempt,
  notificationJobId,
  processNotificationJob,
  reconcileFutureNotificationJobs,
  scheduleAppointmentNotifications,
  syncNotificationAttempts,
} from '@atendente/database';

const connection = process.env.TEST_DATABASE_URL,
  redis = process.env.TEST_REDIS_URL;
if (
  !connection ||
  new URL(connection).pathname !== '/task002_test' ||
  connection !== process.env.DATABASE_URL ||
  !redis ||
  redis !== process.env.REDIS_URL
)
  throw new Error('Use pnpm db:test.');
const clock = (value: string) => new Date(`1970-01-01T${value}:00.000Z`);

test('TASK-028: scheduling, outbox, idempotência, retry, tenant e recovery BullMQ', async (t) => {
  const client = createDatabaseClient(connection),
    queue = createNotificationQueue(redis);
  try {
    const tenant = await client.tenant.create({
      data: { name: 'Worker A', status: 'ACTIVE', timezone: 'UTC' },
    });
    const other = await client.tenant.create({
      data: { name: 'Worker B', status: 'ACTIVE', timezone: 'UTC' },
    });
    const unit = await client.unit.create({
      data: {
        tenantId: tenant.id,
        name: 'Centro',
        address: 'Rua A',
        timezoneOverride: 'America/Sao_Paulo',
      },
    });
    const patient = await client.patient.create({
      data: {
        tenantId: tenant.id,
        name: 'Paciente',
        birthDate: new Date('2000-01-01T00:00:00Z'),
      },
    });
    const contact = await client.contact.create({
      data: { tenantId: tenant.id, displayName: 'Contato' },
    });
    await client.contactChannel.create({
      data: {
        tenantId: tenant.id,
        contactId: contact.id,
        type: 'WHATSAPP',
        address: '+5561999999999',
        primary: true,
        verifiedAt: new Date(),
      },
    });
    await client.contactPatient.create({
      data: {
        tenantId: tenant.id,
        contactId: contact.id,
        patientId: patient.id,
        relationshipType: 'SELF',
        relationshipStatus: 'DECLARED',
        authorizationLevel: 'NO_ACCESS',
        isPrimaryContact: true,
      },
    });
    const specialty = await client.specialty.create({
      data: { tenantId: tenant.id, name: 'Clínica' },
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
    const integration = await client.integration.create({
      data: {
        tenantId: tenant.id,
        phoneNumberId: '9912345678',
        externalAccountId: '8812345678',
        credentialsReference: 'WHATSAPP_ACCESS_TOKEN_TEST',
      },
    });
    const conversation = await client.conversation.create({
      data: {
        tenantId: tenant.id,
        contactId: contact.id,
        activePatientId: patient.id,
        integrationId: integration.id,
        status: 'AI_ACTIVE',
        channel: 'WHATSAPP',
      },
    });
    const appointment = await client.appointment.create({
      data: {
        tenantId: tenant.id,
        patientId: patient.id,
        contactId: contact.id,
        serviceId: service.id,
        providerId: provider.id,
        unitId: unit.id,
        startAt: new Date('2027-01-05T11:00:00Z'),
        endAt: new Date('2027-01-05T11:30:00Z'),
        occupiedStartAt: new Date('2027-01-05T11:00:00Z'),
        occupiedEndAt: new Date('2027-01-05T11:30:00Z'),
        createdByType: 'SYSTEM',
      },
    });
    const rule = await client.notificationRule.create({
      data: {
        tenantId: tenant.id,
        type: 'CONFIRMATION',
        offsetMinutes: 240,
        allowedStartTime: clock('00:00'),
        allowedEndTime: clock('23:59'),
        allowedWeekdays: [
          'MONDAY',
          'TUESDAY',
          'WEDNESDAY',
          'THURSDAY',
          'FRIDAY',
          'SATURDAY',
          'SUNDAY',
        ],
        outsideWindowPolicy: 'PREVIOUS_ALLOWED_TIME',
        retryEnabled: true,
        retryAfterMinutes: 60,
        maxAttempts: 2,
        minimumTimeBeforeAppointment: 0,
        actionIfNoResponse: 'NONE',
      },
    });

    await t.test(
      'upsert e job determinístico recuperam Redis vazio sem duplicar',
      async () => {
        await queue.obliterate({ force: true });
        const first = await scheduleAppointmentNotifications(
          client,
          tenant.id,
          appointment.id,
        );
        const second = await scheduleAppointmentNotifications(
          client,
          tenant.id,
          appointment.id,
        );
        assert.equal(first.length, 1);
        assert.equal(second.length, 1);
        assert.equal(
          await client.notificationAttempt.count({
            where: { tenantId: tenant.id, appointmentId: appointment.id },
          }),
          1,
        );
        await queue.drain(true);
        assert.equal(
          (await reconcileFutureNotificationJobs(client, 366)).appointments >=
            1,
          true,
        );
        await dispatchNotificationJobs(client, queue, 366);
        const jobId = notificationJobId(
          notificationPayloadFromAttempt(
            await client.notificationAttempt.findFirstOrThrow({
              where: { tenantId: tenant.id, appointmentId: appointment.id },
            }),
          ),
        );
        assert.ok(await queue.getJob(jobId));
        await dispatchNotificationJobs(client, queue, 366);
        assert.ok(await queue.getJob(jobId));
      },
    );

    const attempt = await client.notificationAttempt.findFirstOrThrow({
      where: {
        tenantId: tenant.id,
        appointmentId: appointment.id,
        notificationRuleId: rule.id,
      },
    });
    await client.notificationAttempt.update({
      where: { id: attempt.id },
      data: { scheduledAt: new Date(), nextDispatchAt: new Date() },
    });
    const payload = notificationPayloadFromAttempt(attempt);
    await t.test(
      'dois processors convergem para uma única Message e payload cross-tenant falha fechado',
      async () => {
        const results = await Promise.all([
          processNotificationJob(client, payload),
          processNotificationJob(client, payload),
        ]);
        assert.equal(results.filter((r) => r.outcome === 'OUTBOXED').length, 1);
        assert.equal(
          await client.message.count({
            where: { tenantId: tenant.id, conversationId: conversation.id },
          }),
          1,
        );
        await assert.rejects(
          processNotificationJob(client, { ...payload, tenantId: other.id }),
        );
      },
    );

    await t.test(
      'MessagingProvider envia a outbox uma vez e retry funcional preserva tentativa',
      async () => {
        let sends = 0;
        const fake: MessagingProvider = {
          verifyWebhook() {
            return '';
          },
          verifySignature() {
            return true;
          },
          parseInboundWebhook() {
            return [];
          },
          parseStatusWebhook() {
            return [];
          },
          async sendTextMessage() {
            sends++;
            return 'wamid.task028';
          },
          async sendMediaMessage() {
            throw new Error('unused');
          },
          async sendInteractiveMessage() {
            throw new Error('unused');
          },
        };
        const message = await client.message.findFirstOrThrow({
          where: { tenantId: tenant.id, conversationId: conversation.id },
        });
        await deliverMessage(
          client,
          { tenantId: tenant.id, messageId: message.id },
          fake,
          () => 'token',
        );
        await deliverMessage(
          client,
          { tenantId: tenant.id, messageId: message.id },
          fake,
          () => 'token',
        );
        assert.equal(sends, 1);
        await syncNotificationAttempts(client);
        const rows = await client.notificationAttempt.findMany({
          where: { tenantId: tenant.id, appointmentId: appointment.id },
          orderBy: { attemptNumber: 'asc' },
        });
        assert.equal(rows[0]!.status, 'SENT');
        assert.equal(rows[0]!.messageId, message.id);
        assert.equal(rows.length, 2);
        assert.equal(rows[1]!.attemptNumber, 2);
        await client.appointment.update({
          where: { id: appointment.id },
          data: { status: 'CONFIRMED' },
        });
        await reconcileFutureNotificationJobs(client, 366);
        assert.equal(
          (
            await client.notificationAttempt.findUniqueOrThrow({
              where: { id: rows[1]!.id },
            })
          ).status,
          'CANCELLED',
        );
      },
    );

    await t.test(
      'TASK-030: no-response gera um handoff AUTOMATION/WORKER com correlação',
      async () => {
        const noResponseAppointment = await client.appointment.create({
          data: {
            tenantId: tenant.id,
            patientId: patient.id,
            contactId: contact.id,
            serviceId: service.id,
            providerId: provider.id,
            unitId: unit.id,
            startAt: new Date('2027-01-07T11:00:00Z'),
            endAt: new Date('2027-01-07T11:30:00Z'),
            occupiedStartAt: new Date('2027-01-07T11:00:00Z'),
            occupiedEndAt: new Date('2027-01-07T11:30:00Z'),
            createdByType: 'SYSTEM',
            status: 'PENDING_CONFIRMATION',
          },
        });
        const automaticRule = await client.notificationRule.create({
          data: {
            tenantId: tenant.id,
            type: 'CONFIRMATION',
            offsetMinutes: 0,
            allowedStartTime: clock('00:00'),
            allowedEndTime: clock('23:59'),
            allowedWeekdays: ['MONDAY'],
            outsideWindowPolicy: 'PREVIOUS_ALLOWED_TIME',
            retryEnabled: false,
            maxAttempts: 1,
            actionIfNoResponse: 'NEEDS_HUMAN',
          },
        });
        const message = await client.message.create({
          data: {
            tenantId: tenant.id,
            conversationId: conversation.id,
            integrationId: integration.id,
            recipientAddress: '+5561999999999',
            senderType: 'AI',
            messageType: 'TEXT',
            content: 'Confirmar',
            channel: 'WHATSAPP',
            deliveryStatus: 'SENT',
            providerMessageId: 'wamid.audit.' + randomUUID(),
            sentAt: new Date(),
          },
        });
        const attemptId = randomUUID(),
          auditCorrelationId = randomUUID();
        await client.notificationAttempt.create({
          data: {
            id: attemptId,
            tenantId: tenant.id,
            appointmentId: noResponseAppointment.id,
            notificationRuleId: automaticRule.id,
            messageId: message.id,
            type: 'CONFIRMATION',
            cycleKey: 'a'.repeat(64),
            attemptNumber: 1,
            scheduledAt: new Date('2020-01-01'),
            nextDispatchAt: new Date('2020-01-01'),
            status: 'SENT',
            sentAt: new Date('2020-01-01'),
            correlationId: auditCorrelationId,
          },
        });
        await syncNotificationAttempts(client);
        await syncNotificationAttempts(client);
        const audits = await client.authEvent.findMany({
          where: {
            tenantId: tenant.id,
            resourceId: conversation.id,
            type: 'HUMAN_HANDOFF_REQUESTED',
            correlationId: auditCorrelationId,
          },
        });
        assert.equal(audits.length, 1);
        assert.equal(audits[0]!.actorType, 'AUTOMATION');
        assert.equal(audits[0]!.source, 'WORKER');
        assert.equal(audits[0]!.userId, null);
        assert.equal(audits[0]!.isBusiness, true);
        await client.conversation.update({
          where: { id: conversation.id },
          data: {
            status: 'AI_ACTIVE',
            handoffReason: null,
            handoffRequestedAt: null,
          },
        });
      },
    );

    await t.test(
      'cenário crítico 08:00 encerra no-response quando retry ajustado não avança',
      async () => {
        const criticalRule = await client.notificationRule.create({
          data: {
            tenantId: tenant.id,
            type: 'CONFIRMATION',
            offsetMinutes: 240,
            allowedStartTime: clock('08:00'),
            allowedEndTime: clock('20:00'),
            allowedWeekdays: [
              'MONDAY',
              'TUESDAY',
              'WEDNESDAY',
              'THURSDAY',
              'FRIDAY',
            ],
            outsideWindowPolicy: 'PREVIOUS_ALLOWED_TIME',
            retryEnabled: true,
            retryAfterMinutes: 240,
            maxAttempts: 2,
            minimumTimeBeforeAppointment: 0,
            actionIfNoResponse: 'NONE',
          },
        });
        const criticalAppointment = await client.appointment.create({
          data: {
            tenantId: tenant.id,
            patientId: patient.id,
            contactId: contact.id,
            serviceId: service.id,
            providerId: provider.id,
            unitId: unit.id,
            startAt: new Date('2027-01-12T11:00:00Z'),
            endAt: new Date('2027-01-12T11:30:00Z'),
            occupiedStartAt: new Date('2027-01-12T11:00:00Z'),
            occupiedEndAt: new Date('2027-01-12T11:30:00Z'),
            createdByType: 'SYSTEM',
          },
        });
        await scheduleAppointmentNotifications(
          client,
          tenant.id,
          criticalAppointment.id,
        );
        const critical = await client.notificationAttempt.findFirstOrThrow({
          where: {
            tenantId: tenant.id,
            appointmentId: criticalAppointment.id,
            notificationRuleId: criticalRule.id,
          },
        });
        assert.equal(
          critical.scheduledAt.toISOString(),
          '2027-01-11T23:00:00.000Z',
        );
        await client.notificationAttempt.update({
          where: { id: critical.id },
          data: {
            status: 'SENT',
            sentAt: new Date('2027-01-11T23:00:00Z'),
          },
        });
        await syncNotificationAttempts(client);
        const finished = await client.notificationAttempt.findUniqueOrThrow({
          where: { id: critical.id },
        });
        assert.equal(finished.outcome, 'NO_RESPONSE_NONE');
        assert.notEqual(finished.noResponseAt, null);
        assert.equal(
          await client.notificationAttempt.count({
            where: {
              tenantId: tenant.id,
              appointmentId: criticalAppointment.id,
              notificationRuleId: criticalRule.id,
            },
          }),
          1,
        );
        await client.notificationRule.update({
          where: { id: criticalRule.id },
          data: { active: false },
        });
      },
    );

    await t.test(
      'cancelamento invalida tentativa futura e HOLD cleanup preserva estados semânticos',
      async () => {
        await client.appointment.update({
          where: { id: appointment.id },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
        });
        await reconcileFutureNotificationJobs(client, 366);
        const retry = await client.notificationAttempt.findFirstOrThrow({
          where: {
            tenantId: tenant.id,
            appointmentId: appointment.id,
            attemptNumber: 2,
          },
        });
        assert.equal(retry.status, 'CANCELLED');
        assert.equal(
          await client.message.count({ where: { tenantId: other.id } }),
          0,
        );
      },
    );

    await t.test(
      'remarcação invalida reminder antigo e o novo Appointment recebe mensagem do horário atual',
      async () => {
        const reminder = await client.notificationRule.create({
          data: {
            tenantId: tenant.id,
            type: 'REMINDER',
            offsetMinutes: 1440,
            allowedStartTime: clock('00:00'),
            allowedEndTime: clock('23:59'),
            allowedWeekdays: [
              'MONDAY',
              'TUESDAY',
              'WEDNESDAY',
              'THURSDAY',
              'FRIDAY',
              'SATURDAY',
              'SUNDAY',
            ],
            outsideWindowPolicy: 'PREVIOUS_ALLOWED_TIME',
            retryEnabled: false,
            maxAttempts: 1,
            minimumTimeBeforeAppointment: 0,
            actionIfNoResponse: 'NONE',
          },
        });
        const original = await client.appointment.create({
          data: {
            tenantId: tenant.id,
            patientId: patient.id,
            contactId: contact.id,
            serviceId: service.id,
            providerId: provider.id,
            unitId: unit.id,
            startAt: new Date('2027-01-06T18:00:00Z'),
            endAt: new Date('2027-01-06T18:30:00Z'),
            occupiedStartAt: new Date('2027-01-06T18:00:00Z'),
            occupiedEndAt: new Date('2027-01-06T18:30:00Z'),
            createdByType: 'SYSTEM',
          },
        });
        await scheduleAppointmentNotifications(client, tenant.id, original.id);
        const obsolete = await client.notificationAttempt.findFirstOrThrow({
          where: {
            tenantId: tenant.id,
            appointmentId: original.id,
            notificationRuleId: reminder.id,
          },
        });
        const successor = await client.$transaction(async (tx) => {
          await tx.appointment.update({
            where: { id: original.id },
            data: { status: 'RESCHEDULED' },
          });
          return tx.appointment.create({
            data: {
              tenantId: tenant.id,
              patientId: patient.id,
              contactId: contact.id,
              serviceId: service.id,
              providerId: provider.id,
              unitId: unit.id,
              previousAppointmentId: original.id,
              startAt: new Date('2027-01-08T13:00:00Z'),
              endAt: new Date('2027-01-08T13:30:00Z'),
              occupiedStartAt: new Date('2027-01-08T13:00:00Z'),
              occupiedEndAt: new Date('2027-01-08T13:30:00Z'),
              status: 'CONFIRMED',
              createdByType: 'SYSTEM',
            },
          });
        });
        assert.equal(
          (
            await processNotificationJob(
              client,
              notificationPayloadFromAttempt(obsolete),
            )
          ).outcome,
          'APPOINTMENT_INELIGIBLE',
        );
        await scheduleAppointmentNotifications(client, tenant.id, successor.id);
        const current = await client.notificationAttempt.findFirstOrThrow({
          where: {
            tenantId: tenant.id,
            appointmentId: successor.id,
            notificationRuleId: reminder.id,
          },
        });
        await client.notificationAttempt.update({
          where: { id: current.id },
          data: { scheduledAt: new Date(), nextDispatchAt: new Date() },
        });
        assert.equal(
          (
            await processNotificationJob(
              client,
              notificationPayloadFromAttempt(current),
            )
          ).outcome,
          'OUTBOXED',
        );
        const outbound = await client.message.findFirstOrThrow({
          where: {
            tenantId: tenant.id,
            notificationAttempt: { id: current.id },
          },
        });
        assert.match(outbound.content, /08\/01\/2027/);
        assert.doesNotMatch(outbound.content, /06\/01\/2027/);
      },
    );

    await t.test(
      'constraints físicas bloqueiam rule/appointment cross-tenant',
      async () => {
        await assert.rejects(
          client.notificationAttempt.create({
            data: {
              tenantId: other.id,
              appointmentId: appointment.id,
              notificationRuleId: rule.id,
              type: 'CONFIRMATION',
              cycleKey: 'a'.repeat(64),
              attemptNumber: 1,
              scheduledAt: new Date(),
              nextDispatchAt: new Date(),
              correlationId: randomUUID(),
            },
          }),
        );
      },
    );
  } finally {
    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close();
    await client.$disconnect();
  }
});
