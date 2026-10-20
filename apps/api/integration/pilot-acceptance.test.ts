import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  AI_PROVIDER,
  type AIRequest,
  type AIResponse,
} from '@atendente/domain';
import {
  createDatabaseClient,
  createNotificationQueue,
  createNotificationWorker,
  notificationJobId,
  notificationPayloadFromAttempt,
  reconcileAndDispatchNotifications,
  encryptTenantCredential,
  type NotificationJobPayload,
} from '@atendente/database';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap';
import { AuthConfig } from '../src/auth/auth.config';
import { hashPassword } from '../src/auth/password';
import { FakeAIProvider } from '../src/ai/fake-ai.provider';
import {
  RealtimeEvents,
  type RealtimeEvent,
} from '../src/realtime/realtime.events';

const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
if (
  !databaseUrl ||
  databaseUrl !== process.env.DATABASE_URL ||
  new URL(databaseUrl).pathname !== '/task002_test' ||
  !redisUrl ||
  redisUrl !== process.env.REDIS_URL
)
  throw new Error('Use pnpm db:test.');

const waitFor = async (check: () => Promise<boolean>, label: string) => {
  const deadline = Date.now() + 20_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timeout: ${label}`);
    await delay(40);
  }
};

function nextTuesday() {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  const days = (2 - date.getUTCDay() + 7) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function response(
  request: AIRequest,
  values: Partial<AIResponse> & { content: string },
): AIResponse {
  return {
    finishReason: 'completed',
    usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
    provider: 'fake',
    model: request.modelConfig.model,
    latencyMs: 0,
    attempts: 1,
    ...values,
  };
}

test('acceptance conectado: webhook, engine, scheduling, workers, handoff e tenant isolation', async (t) => {
  const env = {
    engine: process.env.CONVERSATION_ENGINE_ENABLED,
    redis: process.env.REDIS_URL,
    aiKey: process.env.OPENAI_API_KEY,
    aiModel: process.env.OPENAI_MODEL,
    aiBaseUrl: process.env.OPENAI_BASE_URL,
    aiTimeout: process.env.OPENAI_TIMEOUT_MS,
    aiOutputTokens: process.env.OPENAI_MAX_OUTPUT_TOKENS,
    tenantCredentialsKey: process.env.TENANT_CREDENTIALS_KEY,
    whatsappSecret: process.env.WHATSAPP_APP_SECRET,
    whatsappVersion: process.env.WHATSAPP_GRAPH_VERSION,
    whatsappToken: process.env.WHATSAPP_ACCESS_TOKEN_ACCEPTANCE,
  };
  process.env.CONVERSATION_ENGINE_ENABLED = 'true';
  process.env.REDIS_URL = redisUrl;
  process.env.OPENAI_API_KEY = 'sk-test-fixture-only';
  process.env.OPENAI_MODEL = 'pilot-fixture-model';
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';
  process.env.OPENAI_TIMEOUT_MS = '1000';
  process.env.OPENAI_MAX_OUTPUT_TOKENS = '512';
  process.env.TENANT_CREDENTIALS_KEY = Buffer.alloc(32, 5).toString('base64');
  process.env.WHATSAPP_APP_SECRET = 'acceptance-app-secret';
  process.env.WHATSAPP_GRAPH_VERSION = 'v23.0';
  process.env.WHATSAPP_ACCESS_TOKEN_ACCEPTANCE = 'acceptance-access-token';

  const client = createDatabaseClient(databaseUrl);
  const providerCalls = new Map<string, number>();
  const context = {
    tenantId: '',
    contactId: '',
    patientId: '',
    specialtyId: '',
    serviceId: '',
    providerId: '',
    unitId: '',
    appointmentDate: nextTuesday(),
  };
  const none = {
    action: 'NONE',
    patientId: null,
    specialtyId: null,
    serviceId: null,
    providerId: null,
    unitId: null,
    preferredDate: null,
    preferredPeriod: null,
    optionNumber: null,
  };
  const plans = new Map<string, Record<string, unknown>[]>();
  const fakeAI = new FakeAIProvider(async (request) => {
    const correlationId = request.correlationId ?? 'missing-correlation';
    const turns =
      plans.get(correlationId) ??
      (() => {
        const inbound =
          [...request.messages]
            .reverse()
            .find(
              (message) =>
                message.role === 'USER' &&
                !message.content.startsWith('Estado estruturado confiável') &&
                !message.content.startsWith(
                  'Contexto administrativo confiável',
                ) &&
                !message.content.startsWith('Resultado do workflow'),
            )
            ?.content.toLocaleLowerCase('pt-BR') ?? '';
        let steps: Record<string, unknown>[];
        const base = {
          intent: 'SCHEDULING',
          confidence: 0.99,
          response: null,
          waitingForPatient: true,
          handoffReason: null,
          summary: null,
          toolCalls: [],
        };
        const command = (
          action: string,
          patch: Record<string, unknown> = {},
        ) => ({
          ...base,
          scheduling: { ...none, action, ...patch },
        });
        if (inbound.includes('quero marcar')) {
          steps = [
            command('START'),
            command('SELECT_SERVICE', {
              specialtyId: context.specialtyId,
              serviceId: context.serviceId,
              providerId: context.providerId,
              unitId: context.unitId,
            }),
            command('SET_PREFERENCES', {
              preferredDate: context.appointmentDate,
              preferredPeriod: 'MORNING',
            }),
            command('SEARCH_SLOTS'),
            {
              ...base,
              response: 'Encontrei horários disponíveis.',
              scheduling: none,
            },
          ];
        } else if (inbound.includes('opção 1')) {
          steps = [
            command('SELECT_SLOT', { optionNumber: 1 }),
            { ...base, response: 'Confirma este horário?', scheduling: none },
          ];
        } else if (inbound.includes('confirmo')) {
          steps = [
            command('CONFIRM'),
            {
              ...base,
              response: 'Agendamento solicitado com sucesso.',
              scheduling: none,
            },
          ];
        } else if (inbound.includes('atendente')) {
          steps = [
            {
              intent: 'OTHER',
              confidence: 0.99,
              response: null,
              waitingForPatient: false,
              handoffReason: 'USER_REQUESTED_HUMAN',
              summary: 'Paciente pediu atendimento humano.',
              scheduling: none,
              toolCalls: [],
            },
          ];
        } else {
          steps = [
            { ...base, response: 'Atendimento registrado.', scheduling: none },
          ];
        }
        plans.set(correlationId, steps);
        return steps;
      })();
    const index = providerCalls.get(correlationId) ?? 0;
    providerCalls.set(correlationId, index + 1);
    const output = turns[index] ?? turns.at(-1)!;
    return response(request, { content: JSON.stringify(output) });
  });

  const testModule = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AI_PROVIDER)
    .useValue(fakeAI)
    .compile();
  assert.equal(testModule.get(AI_PROVIDER), fakeAI);
  const app = testModule.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  configureApplication(app, app.get(AuthConfig));
  let notificationQueue: ReturnType<typeof createNotificationQueue> | undefined;
  let notificationWorker:
    ReturnType<typeof createNotificationWorker> | undefined;
  const capturedLogs: string[] = [];
  const priorInfo = console.info;
  const priorLogger = Logger.prototype.log;
  const eventLog: RealtimeEvent[] = [];
  let unsubscribe = () => {};
  try {
    console.info = (...args: unknown[]) =>
      capturedLogs.push(args.map(String).join(' '));
    Logger.prototype.log = function (this: Logger, ...args: unknown[]) {
      capturedLogs.push(args.map(String).join(' '));
      return Reflect.apply(priorLogger, this, args);
    } as Logger['log'];
    await app.listen(0, '127.0.0.1');
    const baseUrl = await app.getUrl();
    const readiness = await fetch(`${baseUrl}/health/ready`);
    assert.equal(readiness.status, 200);
    assert.deepEqual(await readiness.json(), {
      status: 'ready',
      dependencies: { database: 'up', rateLimit: 'up' },
    });
    const realtime = app.get(RealtimeEvents);
    unsubscribe = realtime.subscribe((event) => eventLog.push(event));

    const tenantA = await client.tenant.create({
      data: { name: 'Clínica Piloto', status: 'ACTIVE', timezone: 'UTC' },
    });
    const tenantB = await client.tenant.create({
      data: { name: 'Tenant sentinela', status: 'ACTIVE', timezone: 'UTC' },
    });
    for (const tenant of [tenantA, tenantB]) {
      await client.aIProviderCredential.create({
        data: {
          tenantId: tenant.id,
          ...encryptTenantCredential(
            'sk-test-fixture-only',
            tenant.id,
            'OPENAI_API_KEY',
          ),
        },
      });
    }
    context.tenantId = tenantA.id;
    const password = 'pilot acceptance password';
    const passwordHash = await hashPassword(password);
    const createUser = async (
      tenantId: string,
      role: 'CLINIC_ADMIN' | 'AGENT',
    ) =>
      client.user.create({
        data: {
          name: role === 'AGENT' ? 'Agente de teste' : 'Admin de teste',
          email: `${randomUUID()}@pilot.test`,
          passwordHash,
          memberships: { create: { tenantId, role } },
        },
      });
    const adminA = await createUser(tenantA.id, 'CLINIC_ADMIN');
    const agentA = await createUser(tenantA.id, 'AGENT');
    const adminB = await createUser(tenantB.id, 'CLINIC_ADMIN');
    const specialty = await client.specialty.create({
      data: { tenantId: tenantA.id, name: 'Cardiologia' },
    });
    const service = await client.service.create({
      data: {
        tenantId: tenantA.id,
        specialtyId: specialty.id,
        name: 'Consulta cardiológica',
        durationMinutes: 30,
      },
    });
    const professional = await client.provider.create({
      data: {
        tenantId: tenantA.id,
        name: 'Dra. Ana',
        professionalType: 'DOCTOR',
      },
    });
    const unit = await client.unit.create({
      data: {
        tenantId: tenantA.id,
        name: 'Unidade Centro',
        address: 'Rua Teste',
      },
    });
    context.specialtyId = specialty.id;
    context.serviceId = service.id;
    context.providerId = professional.id;
    context.unitId = unit.id;
    await client.providerService.create({
      data: {
        tenantId: tenantA.id,
        providerId: professional.id,
        serviceId: service.id,
      },
    });
    await client.providerUnit.create({
      data: {
        tenantId: tenantA.id,
        providerId: professional.id,
        unitId: unit.id,
      },
    });
    await client.availabilityRule.create({
      data: {
        tenantId: tenantA.id,
        providerId: professional.id,
        unitId: unit.id,
        weekday: 'TUESDAY',
        startTime: new Date('1970-01-01T08:00:00.000Z'),
        endTime: new Date('1970-01-01T12:00:00.000Z'),
        validFrom: new Date('2020-01-01T00:00:00.000Z'),
        validUntil: new Date('2040-12-31T00:00:00.000Z'),
      },
    });
    const notificationRule = await client.notificationRule.create({
      data: {
        tenantId: tenantA.id,
        type: 'CONFIRMATION',
        offsetMinutes: 60,
        allowedStartTime: new Date('1970-01-01T00:00:00.000Z'),
        allowedEndTime: new Date('1970-01-01T23:59:00.000Z'),
        allowedWeekdays: ['TUESDAY'],
        outsideWindowPolicy: 'NEXT_ALLOWED_TIME',
      },
    });
    const integration = await client.integration.create({
      data: {
        tenantId: tenantA.id,
        phoneNumberId: '9000000001',
        externalAccountId: '9000000000',
        credentialsReference: 'WHATSAPP_ACCESS_TOKEN_ACCEPTANCE',
      },
    });
    const contact = await client.contact.create({
      data: { tenantId: tenantA.id, displayName: 'João Teste' },
    });
    const phone = '+5561999912345';
    await client.contactChannel.create({
      data: {
        tenantId: tenantA.id,
        contactId: contact.id,
        type: 'WHATSAPP',
        address: phone,
        providerExternalId: '5561999912345',
        primary: true,
      },
    });
    const patient = await client.patient.create({
      data: {
        tenantId: tenantA.id,
        name: 'João Teste',
        birthDate: new Date('1990-01-01T00:00:00.000Z'),
      },
    });
    context.contactId = contact.id;
    context.patientId = patient.id;
    await client.contactPatient.create({
      data: {
        tenantId: tenantA.id,
        contactId: contact.id,
        patientId: patient.id,
        relationshipType: 'SELF',
        relationshipStatus: 'VERIFIED',
        authorizationLevel: 'FULL',
        authorizedAt: new Date(),
        authorizedBy: adminA.id,
      },
    });

    const foreignContact = await client.contact.create({
      data: { tenantId: tenantB.id, displayName: 'Sentinela' },
    });
    const foreignConversation = await client.conversation.create({
      data: { tenantId: tenantB.id, contactId: foreignContact.id },
    });
    const foreignAuditCount = await client.authEvent.count({
      where: { resourceId: foreignConversation.id },
    });

    const cookies = new Map<string, string>();
    for (const user of [adminA, agentA, adminB]) {
      const login = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: {
          Origin: process.env.AUTH_ORIGIN!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: user.email, password }),
      });
      assert.equal(login.status, 200);
      const cookie = login.headers.get('set-cookie')?.split(';')[0];
      assert.ok(cookie);
      cookies.set(user.id, cookie);
      const tenantId = user.id === adminB.id ? tenantB.id : tenantA.id;
      const active = await fetch(`${baseUrl}/tenancy/active`, {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: process.env.AUTH_ORIGIN!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tenantId }),
      });
      assert.equal(active.status, 200);
    }

    const envelope = (providerMessageId: string, body: string) => ({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '9000000000',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: integration.phoneNumberId },
                contacts: [
                  { wa_id: '5561999912345', profile: { name: 'João Teste' } },
                ],
                messages: [
                  {
                    id: providerMessageId,
                    from: '5561999912345',
                    type: 'text',
                    text: { body },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const webhook = async (providerMessageId: string, body: string) => {
      const raw = JSON.stringify(envelope(providerMessageId, body));
      const signature =
        'sha256=' +
        createHmac('sha256', process.env.WHATSAPP_APP_SECRET!)
          .update(raw)
          .digest('hex');
      return fetch(`${baseUrl}/webhooks/whatsapp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': signature,
        },
        body: raw,
      });
    };
    const inboundIds: string[] = [];
    const reportedCorrelations: string[] = [];
    const sendAndWait = async (body: string) => {
      const providerMessageId = `wamid.pilot.${randomUUID()}`;
      const response = await webhook(providerMessageId, body);
      assert.equal(response.status, 200);
      const message = await client.message.findFirstOrThrow({
        where: { tenantId: tenantA.id, providerMessageId },
        include: { inboundProcessingRun: true },
      });
      inboundIds.push(message.id);
      const runId = message.inboundProcessingRun!.id;
      await waitFor(async () => {
        const run = await client.aIProcessingRun.findUnique({
          where: { id: runId },
        });
        return run?.status === 'COMPLETED' || run?.status === 'FAILED';
      }, 'Conversation Engine run');
      const run = await client.aIProcessingRun.findUniqueOrThrow({
        where: { id: runId },
      });
      assert.equal(run.status, 'COMPLETED', run.errorCode ?? 'run failed');
      reportedCorrelations.push(run.correlationId);
      return { providerMessageId, message, run };
    };

    await t.test(
      'webhook autenticado grava inbound e executa busca real de slots',
      async () => {
        const initial = await sendAndWait(
          'Quero marcar cardiologia terça de manhã.',
        );
        assert.equal(initial.message.tenantId, tenantA.id);
        const conversation = await client.conversation.findUniqueOrThrow({
          where: { id: initial.message.conversationId },
        });
        assert.equal(conversation.contactId, contact.id);
        assert.equal(conversation.integrationId, integration.id);
        assert.equal(conversation.status, 'WAITING_PATIENT');
        const runAudits = await client.authEvent.findMany({
          where: { resourceId: initial.message.id },
        });
        assert.equal(initial.run.correlationId.length, 36);
        assert.equal(runAudits.length, 1);
        assert.equal(runAudits[0]!.correlationId, initial.run.correlationId);
        const usage = await client.aIUsage.findMany({
          where: {
            tenantId: tenantA.id,
            correlationId: initial.run.correlationId,
          },
        });
        assert.equal(usage.length, 5);
        assert.equal(
          usage.every((entry) => entry.status === 'SUCCESS'),
          true,
        );
        const executions = await client.toolExecution.findMany({
          where: { tenantId: tenantA.id, conversationId: conversation.id },
        });
        assert.ok(
          executions.some(
            (execution) => execution.toolName === 'search_available_slots',
          ),
        );
        const assistantMessage = await client.message.findFirstOrThrow({
          where: {
            tenantId: tenantA.id,
            conversationId: conversation.id,
            senderType: 'AI',
          },
        });
        assert.equal(assistantMessage.deliveryStatus, 'PENDING');
        const appointmentBeforeSelection = await client.appointment.count({
          where: { tenantId: tenantA.id, contactId: contact.id },
        });
        assert.equal(appointmentBeforeSelection, 0);

        const duplicate = await webhook(
          initial.providerMessageId,
          'Quero marcar cardiologia terça de manhã.',
        );
        assert.equal(duplicate.status, 200);
        assert.equal(
          await client.message.count({
            where: {
              tenantId: tenantA.id,
              providerMessageId: initial.providerMessageId,
            },
          }),
          1,
        );
        assert.equal(
          await client.aIProcessingRun.count({
            where: {
              tenantId: tenantA.id,
              inboundMessageId: initial.message.id,
            },
          }),
          1,
        );
      },
    );

    await t.test(
      'seleção mantém HOLD; confirmação explícita cria um Appointment e agenda a notificação',
      async () => {
        const selected = await sendAndWait('A opção 1 serve.');
        const conversationId = selected.message.conversationId;
        const hold = await client.appointmentHold.findFirstOrThrow({
          where: {
            tenantId: tenantA.id,
            contactId: contact.id,
            status: 'ACTIVE',
          },
        });
        assert.equal(hold.patientId, patient.id);
        assert.equal(hold.serviceId, service.id);
        assert.equal(hold.providerId, professional.id);
        assert.equal(hold.unitId, unit.id);
        assert.equal(
          await client.appointment.count({
            where: { tenantId: tenantA.id, contactId: contact.id },
          }),
          0,
        );

        const confirmed = await sendAndWait('Confirmo o horário.');
        assert.equal(confirmed.message.conversationId, conversationId);
        const appointment = await client.appointment.findFirstOrThrow({
          where: { tenantId: tenantA.id, contactId: contact.id },
          include: { hold: true },
        });
        assert.equal(appointment.patientId, patient.id);
        assert.equal(appointment.serviceId, service.id);
        assert.equal(appointment.providerId, professional.id);
        assert.equal(appointment.unitId, unit.id);
        assert.equal(appointment.source, 'WHATSAPP_AI');
        assert.equal(appointment.hold?.status, 'CONSUMED');
        assert.equal(
          await client.appointment.count({
            where: { tenantId: tenantA.id, contactId: contact.id },
          }),
          1,
        );
        const appointmentAudit = await client.authEvent.findFirstOrThrow({
          where: {
            tenantId: tenantA.id,
            resourceId: appointment.id,
            type: 'APPOINTMENT_CREATED',
          },
        });
        assert.equal(
          appointmentAudit.correlationId,
          confirmed.run.correlationId,
        );
        const duplicateConfirmation = await webhook(
          confirmed.providerMessageId,
          'Confirmo o horário.',
        );
        assert.equal(duplicateConfirmation.status, 200);
        assert.equal(
          await client.appointment.count({
            where: { tenantId: tenantA.id, contactId: contact.id },
          }),
          1,
        );
        assert.equal(
          await client.appointmentHold.count({
            where: { tenantId: tenantA.id, contactId: contact.id },
          }),
          1,
        );

        notificationQueue = createNotificationQueue(redisUrl);
        notificationWorker = createNotificationWorker(client, redisUrl, 1);
        await notificationWorker.waitUntilReady();
        await reconcileAndDispatchNotifications(client, notificationQueue, 30);
        const attempt = await client.notificationAttempt.findFirstOrThrow({
          where: {
            tenantId: tenantA.id,
            appointmentId: appointment.id,
            notificationRuleId: notificationRule.id,
          },
        });
        assert.equal(attempt.status, 'SCHEDULED');
        const payload: NotificationJobPayload =
          notificationPayloadFromAttempt(attempt);
        assert.equal(payload.correlationId, attempt.correlationId);
        const job = await notificationQueue.getJob(notificationJobId(payload));
        assert.ok(
          job,
          'worker dispatches the scheduled notification into BullMQ',
        );
        await reconcileAndDispatchNotifications(client, notificationQueue, 30);
        assert.equal(
          await client.notificationAttempt.count({
            where: {
              tenantId: tenantA.id,
              appointmentId: appointment.id,
              notificationRuleId: notificationRule.id,
            },
          }),
          1,
        );
        assert.ok(await notificationQueue.getJob(notificationJobId(payload)));
      },
    );

    await t.test(
      'inbound de handoff e claim autorizado ficam auditados e isolados',
      async () => {
        const handoff = await sendAndWait('Quero falar com um atendente.');
        const conversation = await client.conversation.findUniqueOrThrow({
          where: { id: handoff.message.conversationId },
        });
        assert.equal(conversation.status, 'NEEDS_HUMAN');
        const claimed = await fetch(
          `${baseUrl}/conversations/${conversation.id}/claim`,
          {
            method: 'POST',
            headers: {
              Cookie: cookies.get(agentA.id)!,
              Origin: process.env.AUTH_ORIGIN!,
              'Content-Type': 'application/json',
            },
            body: '{}',
          },
        );
        assert.equal(claimed.status, 200);
        const active = await client.conversation.findUniqueOrThrow({
          where: { id: conversation.id },
        });
        assert.equal(active.status, 'HUMAN_ACTIVE');
        assert.equal(active.assignedUserId, agentA.id);
        const claimAudit = await client.authEvent.findFirstOrThrow({
          where: {
            tenantId: tenantA.id,
            resourceId: conversation.id,
            type: 'CONVERSATION_CLAIMED',
          },
        });
        assert.equal(claimAudit.userId, agentA.id);

        const foreignRead = await fetch(
          `${baseUrl}/conversations/${foreignConversation.id}`,
          {
            headers: {
              Cookie: cookies.get(adminA.id)!,
              Origin: process.env.AUTH_ORIGIN!,
            },
          },
        );
        assert.equal(foreignRead.status, 404);
        const foreignMutation = await fetch(
          `${baseUrl}/conversations/${foreignConversation.id}/status`,
          {
            method: 'POST',
            headers: {
              Cookie: cookies.get(adminA.id)!,
              Origin: process.env.AUTH_ORIGIN!,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ status: 'RESOLVED' }),
          },
        );
        assert.equal(foreignMutation.status, 404);
        assert.equal(
          (
            await client.conversation.findUniqueOrThrow({
              where: { id: foreignConversation.id },
            })
          ).status,
          'AI_ACTIVE',
        );
        assert.equal(
          await client.authEvent.count({
            where: { resourceId: foreignConversation.id },
          }),
          foreignAuditCount,
        );
        assert.equal(
          eventLog.some((event) => event.tenantId === tenantB.id),
          false,
        );
        const claims = await client.authEvent.count({
          where: { resourceId: conversation.id, type: 'CONVERSATION_CLAIMED' },
        });
        assert.equal(claims, 1);
        assert.equal(handoff.run.correlationId.length, 36);
      },
    );

    const currentCalls = [...providerCalls.values()].reduce(
      (sum, value) => sum + value,
      0,
    );
    assert.ok(currentCalls > 0);
    assert.equal(
      capturedLogs.some((line) => line.includes('acceptance-access-token')),
      false,
    );
    assert.equal(
      capturedLogs.some((line) => line.includes('Quero marcar cardiologia')),
      false,
    );
    assert.equal(
      capturedLogs.some((line) => line.includes('João Teste')),
      false,
    );
    assert.equal(
      capturedLogs.some((line) => line.includes('sk-test-fixture-only')),
      false,
    );
    const allCorrelations = await client.aIProcessingRun.findMany({
      where: { tenantId: tenantA.id, inboundMessageId: { in: inboundIds } },
      select: { correlationId: true },
    });
    for (const entry of allCorrelations) {
      assert.ok(
        capturedLogs.some((line) => line.includes(entry.correlationId)),
      );
    }
    t.diagnostic(`correlation_ids=${reportedCorrelations.join(',')}`);
  } finally {
    unsubscribe();
    await notificationWorker?.close();
    await notificationQueue?.close();
    await app.close();
    await testModule.close();
    await client.$disconnect();
    console.info = priorInfo;
    Logger.prototype.log = priorLogger;
    for (const [key, value] of Object.entries(env)) {
      const envKey = {
        engine: 'CONVERSATION_ENGINE_ENABLED',
        redis: 'REDIS_URL',
        aiKey: 'OPENAI_API_KEY',
        aiModel: 'OPENAI_MODEL',
        aiBaseUrl: 'OPENAI_BASE_URL',
        aiTimeout: 'OPENAI_TIMEOUT_MS',
        aiOutputTokens: 'OPENAI_MAX_OUTPUT_TOKENS',
        tenantCredentialsKey: 'TENANT_CREDENTIALS_KEY',
        whatsappSecret: 'WHATSAPP_APP_SECRET',
        whatsappVersion: 'WHATSAPP_GRAPH_VERSION',
        whatsappToken: 'WHATSAPP_ACCESS_TOKEN_ACCEPTANCE',
      }[key]!;
      if (value === undefined) delete process.env[envKey];
      else process.env[envKey] = value;
    }
  }
});
