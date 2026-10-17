import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ContextIdFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { createDatabaseClient } from '@atendente/database';
import {
  AI_PROVIDER,
  AIProviderError,
  type AIRequest,
} from '@atendente/domain';
import { AIModule } from '../src/ai/ai.module';
import { AIService } from '../src/ai/ai.service';
import { AIUsageRepository } from '../src/ai/ai-usage.repository';
import { AIConfigResolver, readAIConfiguration } from '../src/ai/ai.config';
import { FakeAIProvider } from '../src/ai/fake-ai.provider';
import { DatabaseService } from '../src/auth/database.service';
import type { AuthRequest } from '../src/auth/auth.guard';
import { createApplication } from '../src/bootstrap';
const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).pathname !== '/task002_test' ||
  connection !== process.env.DATABASE_URL
)
  throw new Error('Use pnpm db:test.');
const config = () =>
  readAIConfiguration({
    OPENAI_API_KEY: 'sk-test-fixture-only',
    OPENAI_MODEL: 'test-model',
    OPENAI_BASE_URL: 'https://api.openai.com/v1',
    OPENAI_TIMEOUT_MS: '100',
    OPENAI_MAX_OUTPUT_TOKENS: '128',
  });
const input = () => ({
  systemInstructions: 'Instruções privadas.',
  messages: [{ role: 'USER' as const, content: 'Dado privado.' }],
  correlationId: randomUUID(),
});

test('AI: consumo, contexto autorizado, RBAC, concorrência e isolamento PostgreSQL', async (t) => {
  const client = createDatabaseClient(connection);
  let handler = async (r: AIRequest) => ({
    content: 'create_appointment cancel_appointment send_whatsapp',
    finishReason: 'completed' as const,
    usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 },
    provider: 'fake',
    model: r.modelConfig.model,
    latencyMs: 2,
    attempts: 1,
  });
  let calls = 0;
  const seen: AIRequest[] = [];
  const module = await Test.createTestingModule({ imports: [AIModule] })
    .overrideProvider(DatabaseService)
    .useValue({ client })
    .overrideProvider(AIConfigResolver)
    .useValue({ resolve: config })
    .overrideProvider(AI_PROVIDER)
    .useValue(
      new FakeAIProvider(async (r) => {
        calls++;
        seen.push(r);
        return handler(r);
      }),
    )
    .compile();
  async function fixture(role = 'CLINIC_ADMIN') {
    const tenant = await client.tenant.create({
      data: { name: 'AI test', status: 'ACTIVE', timezone: 'UTC' },
    });
    const user = await client.user.create({
      data: {
        email: `${randomUUID()}@ai.test`,
        name: 'AI fixture',
        passwordHash: 'not-used-for-login',
      },
    });
    await client.userTenant.create({
      data: { userId: user.id, tenantId: tenant.id, role },
    });
    const session = await client.authSession.create({
      data: {
        userId: user.id,
        activeTenantId: tenant.id,
        tokenHash: randomUUID().replaceAll('-', '').repeat(2),
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    const scope = {
      tenantId: tenant.id,
      userId: user.id,
      sessionId: session.id,
    };
    const context = ContextIdFactory.create();
    module.registerRequestByContextId(
      {
        identity: { id: user.id, email: user.email, name: user.name },
        sessionId: session.id,
        activeTenantId: tenant.id,
      } as unknown as AuthRequest,
      context,
    );
    const service = await module.resolve(AIService, context);
    return { tenant, user, session, scope, service };
  }
  try {
    const a = await fixture();
    const b = await fixture();
    const agent = await fixture('AGENT');
    const repository = module.get(AIUsageRepository);
    await t.test(
      'DI real, concorrência de tenants, correlation e tokens associados corretamente',
      async () => {
        const ra = input(),
          rb = input();
        await Promise.all([
          a.service.generateResponse(ra),
          b.service.generateResponse(rb),
        ]);
        const rowsA = await a.service.listUsage(),
          rowsB = await b.service.listUsage();
        assert.equal(rowsA.length, 1);
        assert.equal(rowsB.length, 1);
        assert.equal(rowsA[0].correlationId, ra.correlationId);
        assert.equal(rowsB[0].correlationId, rb.correlationId);
        assert.equal(rowsA[0].totalTokens, 10);
        assert.equal(rowsA[0].inputTokens, 7);
        assert.equal(rowsA[0].outputTokens, 3);
        assert.equal(rowsA[0].estimatedCost, null);
        assert.equal(rowsA[0].status, 'SUCCESS');
        assert.equal(rowsA[0].model, 'test-model');
        assert(!JSON.stringify(rowsA).includes('Dado privado'));
        assert(!JSON.stringify(rowsA).includes('Instruções privadas'));
        assert.deepEqual(
          seen.map((r) => r.tenantContext.tenantId).sort(),
          [a.tenant.id, b.tenant.id].sort(),
        );
      },
    );
    await t.test(
      'tenant externo não pode sobrescrever contexto; nem objeto Patient/secret passa',
      async () => {
        const before = calls;
        for (const patch of [
          { tenantId: b.tenant.id },
          { tenantContext: { tenantId: b.tenant.id } },
          { patient: { cpf: '123' } },
        ])
          await assert.rejects(
            a.service.generateResponse({ ...input(), ...patch }),
            AIProviderError,
          );
        assert.equal(calls, before);
      },
    );
    await t.test(
      'repository também valida tenant e permissão, mesmo com IDs conhecidos',
      async () => {
        await assert.rejects(
          repository.begin(
            { ...a.scope, tenantId: b.tenant.id },
            'test-model',
            randomUUID(),
          ),
          ForbiddenException,
        );
        await assert.rejects(
          repository.list({ ...a.scope, tenantId: b.tenant.id }),
          ForbiddenException,
        );
        await assert.rejects(
          agent.service.generateResponse(input()),
          ForbiddenException,
        );
        await assert.rejects(
          repository.begin(agent.scope, 'test-model', randomUUID()),
          ForbiddenException,
        );
      },
    );
    await t.test('sem identidade não chama provider', async () => {
      const context = ContextIdFactory.create();
      module.registerRequestByContextId({}, context);
      const service = await module.resolve(AIService, context);
      await assert.rejects(
        service.generateResponse(input()),
        UnauthorizedException,
      );
    });
    await t.test(
      'resultado que contém comandos é só texto; nenhuma ação de domínio',
      async () => {
        const where = { tenantId: a.tenant.id };
        const before = await Promise.all([
          client.appointment.count({ where }),
          client.appointmentHold.count({ where }),
          client.message.count({ where }),
          client.conversation.count({ where }),
        ]);
        const response = await a.service.generateResponse(input());
        assert.match(response.content, /create_appointment/);
        const after = await Promise.all([
          client.appointment.count({ where }),
          client.appointmentHold.count({ where }),
          client.message.count({ where }),
          client.conversation.count({ where }),
        ]);
        assert.deepEqual(after, before);
      },
    );
    await t.test(
      'intenção persistida antes de inferência; revogação não reatribui nem perde consumo já iniciado',
      async () => {
        const original = handler;
        const r = input();
        handler = async (request) => {
          const row = await client.aIUsage.findFirstOrThrow({
            where: { tenantId: a.tenant.id, correlationId: r.correlationId },
          });
          assert.equal(row.status, 'PENDING');
          await client.userTenant.update({
            where: {
              userId_tenantId: { userId: a.user.id, tenantId: a.tenant.id },
            },
            data: { active: false },
          });
          return original(request);
        };
        try {
          await a.service.generateResponse(r);
          const row = await client.aIUsage.findFirstOrThrow({
            where: { correlationId: r.correlationId },
          });
          assert.equal(row.tenantId, a.tenant.id);
          assert.equal(row.status, 'SUCCESS');
          await assert.rejects(
            a.service.generateResponse(input()),
            ForbiddenException,
          );
        } finally {
          handler = original;
          await client.userTenant.update({
            where: {
              userId_tenantId: { userId: a.user.id, tenantId: a.tenant.id },
            },
            data: { active: true },
          });
        }
      },
    );
    await t.test(
      'erro seguro persistido sem conteúdo, com contagem desconhecida',
      async () => {
        const original = handler;
        const r = input();
        handler = async () => {
          throw new AIProviderError('AI_TIMEOUT', true, 2, 20);
        };
        try {
          await assert.rejects(
            a.service.generateResponse(r),
            (e) => e instanceof AIProviderError && e.code === 'AI_TIMEOUT',
          );
          const row = await client.aIUsage.findFirstOrThrow({
            where: { correlationId: r.correlationId },
          });
          assert.equal(row.status, 'ERROR');
          assert.equal(row.errorCode, 'AI_TIMEOUT');
          assert.equal(row.attempts, 2);
          assert.equal(row.totalTokens, null);
        } finally {
          handler = original;
        }
      },
    );
    await t.test(
      'correlation não é chave de idempotência: repetições reais contabilizadas separadamente',
      async () => {
        const r = input();
        await a.service.generateResponse(r);
        await a.service.generateResponse(r);
        assert.equal(
          await client.aIUsage.count({
            where: { tenantId: a.tenant.id, correlationId: r.correlationId },
          }),
          2,
        );
      },
    );
    await t.test(
      'FK e CHECKs rejeitam tenant inexistente e contagens inválidas',
      async () => {
        const data = {
          tenantId: a.tenant.id,
          provider: 'openai',
          model: 'test-model',
          correlationId: randomUUID(),
        };
        await assert.rejects(
          client.aIUsage.create({ data: { ...data, tenantId: randomUUID() } }),
        );
        await assert.rejects(
          client.aIUsage.create({
            data: { ...data, inputTokens: -1, outputTokens: 2, totalTokens: 1 },
          }),
        );
        await assert.rejects(
          client.aIUsage.create({ data: { ...data, inputTokens: 1 } }),
        );
      },
    );
    await t.test(
      'conclusão vinculada ao registro só pode ser aplicada uma vez',
      async () => {
        const finish = await repository.begin(
          a.scope,
          'test-model',
          randomUUID(),
        );
        const result = {
          status: 'SUCCESS' as const,
          usage: null,
          latencyMs: 1,
          attempts: 1,
        };
        await finish(result);
        await assert.rejects(finish(result), /AI_USAGE_FINALIZATION_FAILED/);
      },
    );
    await t.test(
      'API inicia sem credencial AI e saúde administrativa segue funcionando',
      async () => {
        const saved = process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_API_KEY;
        let app: Awaited<ReturnType<typeof createApplication>> | undefined;
        try {
          app = await createApplication();
          await app.listen(0, '127.0.0.1');
          assert.equal(
            (await fetch(`${await app.getUrl()}/health`)).status,
            200,
          );
        } finally {
          await app?.close();
          if (saved === undefined) delete process.env.OPENAI_API_KEY;
          else process.env.OPENAI_API_KEY = saved;
        }
      },
    );
  } finally {
    await module.close();
    await client.$disconnect();
  }
});
