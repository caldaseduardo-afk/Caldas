import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import {
  AI_PROVIDER,
  AIProviderError,
  type AIProvider,
  type AIRequest,
} from '@atendente/domain';
import { readAIConfiguration, AIConfigResolver } from '../src/ai/ai.config';
import { prepareAIInput, sanitizeAIText } from '../src/ai/ai-context';
import { OpenAIProvider } from '../src/ai/openai.provider';
import { FakeAIProvider } from '../src/ai/fake-ai.provider';
import { AIService } from '../src/ai/ai.service';
import { AIUsageRepository } from '../src/ai/ai-usage.repository';
import { AuthorizationService } from '../src/permissions/authorization.service';
import { engineResponseFormat } from '../src/conversation-engine/conversation-engine.output';
import {
  CONVERSATION_ENGINE_CAPABILITIES,
  ToolRegistry,
} from '../src/tools/tool.schemas';

const env = {
  OPENAI_API_KEY: 'sk-test-only-not-a-real-key',
  OPENAI_MODEL: 'test-model',
  OPENAI_BASE_URL: 'https://api.openai.com/v1',
  OPENAI_TIMEOUT_MS: '100',
  OPENAI_MAX_OUTPUT_TOKENS: '256',
  OPENAI_MAX_RETRIES: '2',
  OPENAI_RETRY_DELAY_MS: '1',
  OPENAI_MAX_RETRY_DELAY_MS: '3',
};
const configuration = () => readAIConfiguration(env);
const request = (): AIRequest => ({
  systemInstructions: 'Instruções internas.',
  messages: [
    { role: 'SYSTEM', content: 'Contexto confiável.' },
    { role: 'USER', content: 'Olá' },
    { role: 'ASSISTANT', content: 'Oi' },
  ],
  tenantContext: { tenantId: randomUUID() },
  correlationId: randomUUID(),
  modelConfig: configuration().modelConfig,
});
const body = (overrides = {}) => ({
  id: 'resp_test',
  object: 'response',
  status: 'completed',
  error: null,
  model: 'test-model',
  output: [
    {
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'Resposta.', annotations: [] }],
    },
  ],
  usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
  ...overrides,
});
const json = (value: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const fails = (code: string) => (error: unknown) => {
  assert(error instanceof AIProviderError);
  assert.equal(error.code, code);
  return true;
};

test('AIProvider resolve por DI e fake é substituível sem rede', async () => {
  const module = await Test.createTestingModule({
    providers: [{ provide: AI_PROVIDER, useValue: new FakeAIProvider() }],
  }).compile();
  const provider = module.get<AIProvider>(AI_PROVIDER);
  assert.equal((await provider.generateResponse(request())).provider, 'fake');
  await module.close();
});
test('SDK recebe contrato normalizado, modelo configurável, instructions, roles e correlação; metadata não segue no prompt', async () => {
  const r = request();
  r.modelConfig = {
    model: 'other-model',
    maxOutputTokens: 200,
    temperature: 0.3,
  };
  const provider: AIProvider = new OpenAIProvider(
    configuration,
    async (url, init) => {
      assert.equal(String(url), 'https://api.openai.com/v1/responses');
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.model, 'other-model');
      assert.equal(payload.temperature, 0.3);
      assert.equal(payload.max_output_tokens, 200);
      assert.equal(payload.instructions, r.systemInstructions);
      assert.deepEqual(
        payload.input.map((m: { role: string }) => m.role),
        ['system', 'user', 'assistant'],
      );
      assert.equal(payload.store, false);
      assert.equal(payload.tools, undefined);
      assert(!String(init?.body).includes(r.tenantContext.tenantId));
      assert.equal(
        new Headers(init?.headers).get('x-client-request-id'),
        r.correlationId,
      );
      return json(body(), 200, { 'x-request-id': 'req_test' });
    },
  );
  const response = await provider.generateResponse(r);
  assert.equal(response.content, 'Resposta.');
  assert.equal(response.provider, 'openai');
  assert.equal(response.model, 'other-model');
  assert.equal(response.providerRequestId, 'req_test');
  assert.equal(response.finishReason, 'completed');
  assert.equal(response.attempts, 1);
  assert.deepEqual(response.usage, {
    inputTokens: 10,
    outputTokens: 4,
    totalTokens: 14,
  });
  assert(response.latencyMs >= 0);
});
test('config ausente e inválida falha sem expor valores; modelo e timeout não têm defaults implícitos', () => {
  for (const key of [
    'OPENAI_API_KEY',
    'OPENAI_MODEL',
    'OPENAI_BASE_URL',
    'OPENAI_TIMEOUT_MS',
    'OPENAI_MAX_OUTPUT_TOKENS',
  ])
    assert.throws(
      () => readAIConfiguration({ ...env, [key]: '' }),
      fails('AI_CONFIG_ERROR'),
    );
  for (const patch of [
    { OPENAI_BASE_URL: 'http://localhost' },
    { OPENAI_BASE_URL: 'https://key:secret@example.com' },
    { OPENAI_TIMEOUT_MS: '-1' },
    { OPENAI_MAX_RETRIES: '4' },
    { OPENAI_TEMPERATURE: 'NaN' },
  ])
    assert.throws(
      () => readAIConfiguration({ ...env, ...patch }),
      fails('AI_CONFIG_ERROR'),
    );
  assert.equal(configuration().modelConfig.temperature, undefined);
});
test('sanitização projeta contexto mínimo e redige credenciais/identificadores conhecidos', () => {
  const prepared = prepareAIInput(
    {
      systemInstructions: 'Converse.',
      messages: [
        {
          role: 'USER',
          content: `${env.OPENAI_API_KEY} token=SECRET senha=PASSWORD CPF 123.456.789-01 +55 (61) 99999-9999 mail@test.example`,
        },
      ],
    },
    [env.OPENAI_API_KEY],
  );
  const value = JSON.stringify(prepared);
  for (const secret of [
    env.OPENAI_API_KEY,
    'SECRET',
    'PASSWORD',
    '123.456',
    '99999',
    'mail@test',
  ])
    assert(!value.includes(secret));
  for (const patch of [
    { tenantId: randomUUID() },
    { tenantContext: {} },
    { patient: {} },
    { passwordHash: 'hash' },
    { tools: [] },
    { modelConfig: {} },
  ])
    assert.throws(
      () => prepareAIInput({ systemInstructions: 'A', messages: [], ...patch }),
      fails('AI_BAD_REQUEST'),
    );
  assert.throws(
    () =>
      prepareAIInput({
        systemInstructions: 'A',
        messages: [{ role: 'PATIENT', content: 'A' }],
      }),
    fails('AI_BAD_REQUEST'),
  );
});
test('schema é encaminhado como text.format estrito e JSON inválido não é repetido', async () => {
  const r = request();
  r.responseFormat = {
    type: 'json_schema',
    name: 'answer',
    schema: {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    },
  };
  let calls = 0;
  const provider = new OpenAIProvider(configuration, async (_, init) => {
    calls++;
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.text.format.strict, true);
    assert.equal(payload.text.format.type, 'json_schema');
    return json(body());
  });
  await assert.rejects(
    provider.generateResponse(r),
    fails('AI_INVALID_RESPONSE'),
  );
  assert.equal(calls, 1);
});
for (const [status, code, retryable] of [
  [401, 'AI_AUTH_ERROR', false],
  [403, 'AI_AUTH_ERROR', false],
  [400, 'AI_BAD_REQUEST', false],
  [422, 'AI_BAD_REQUEST', false],
  [429, 'AI_RATE_LIMIT', true],
  [500, 'AI_PROVIDER_UNAVAILABLE', true],
  [503, 'AI_PROVIDER_UNAVAILABLE', true],
  [408, 'AI_TIMEOUT', true],
] as const) {
  test(`HTTP ${status}: código seguro e retry ${retryable}`, async () => {
    let calls = 0;
    const provider = new OpenAIProvider(configuration, async () => {
      calls++;
      return json(
        {
          error: {
            message: 'SENSITIVE STACK sk-secret patient details',
            code: 'test',
          },
        },
        status,
      );
    });
    await assert.rejects(provider.generateResponse(request()), (error) => {
      fails(code)(error);
      const e = error as AIProviderError;
      assert.equal(e.retryable, retryable);
      assert.equal(e.attempts, retryable ? 3 : 1);
      assert(!JSON.stringify(error).includes('SENSITIVE'));
      assert(!e.stack?.includes('sk-secret'));
      return true;
    });
    assert.equal(calls, retryable ? 3 : 1);
  });
}
test('429 quota permanente não é repetido', async () => {
  let calls = 0;
  const provider = new OpenAIProvider(configuration, async () => {
    calls++;
    return json({ error: { code: 'insufficient_quota' } }, 429);
  });
  await assert.rejects(provider.generateResponse(request()), (error) => {
    fails('AI_RATE_LIMIT')(error);
    assert.equal((error as AIProviderError).retryable, false);
    return true;
  });
  assert.equal(calls, 1);
});
test('Retry-After acima do limite encerra sem retry prematuro', async () => {
  let calls = 0;
  const provider = new OpenAIProvider(configuration, async () => {
    calls++;
    return json({ error: { code: 'rate_limit' } }, 429, {
      'retry-after': '30',
    });
  });
  await assert.rejects(
    provider.generateResponse(request()),
    fails('AI_RATE_LIMIT'),
  );
  assert.equal(calls, 1);
});
test('falha temporária seguida de sucesso para de repetir na resposta útil', async () => {
  let calls = 0;
  const provider = new OpenAIProvider(configuration, async () =>
    ++calls === 1 ? json({ error: {} }, 503) : json(body()),
  );
  assert.equal((await provider.generateResponse(request())).attempts, 2);
  assert.equal(calls, 2);
});
test('rede indisponível é transitória com limite e sem erro cru', async () => {
  let calls = 0;
  const provider = new OpenAIProvider(configuration, async () => {
    calls++;
    throw new Error('sensitive socket error');
  });
  await assert.rejects(
    provider.generateResponse(request()),
    fails('AI_PROVIDER_UNAVAILABLE'),
  );
  assert.equal(calls, 3);
});
test('timeout cobre chamada pendente, aborta e respeita máximo de tentativas', async () => {
  let calls = 0;
  const signals: AbortSignal[] = [];
  const provider = new OpenAIProvider(
    () => ({ ...configuration(), timeoutMs: 10 }),
    async (_, init) => {
      calls++;
      signals.push(init!.signal!);
      return new Promise<Response>(() => {});
    },
  );
  await assert.rejects(
    provider.generateResponse(request()),
    fails('AI_TIMEOUT'),
  );
  assert.equal(calls, 3);
  assert(signals.every((s) => s.aborted));
});
for (const [name, patch] of Object.entries({
  empty: { output: [] },
  malformed: { output: null },
  incomplete: { status: 'incomplete' },
  negative: { usage: { input_tokens: -1, output_tokens: 1, total_tokens: 0 } },
  mismatch: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 99 } },
})) {
  test(`resposta ${name} falha controlada sem retry`, async () => {
    let calls = 0;
    const provider = new OpenAIProvider(configuration, async () => {
      calls++;
      return json(body(patch));
    });
    await assert.rejects(provider.generateResponse(request()), (error) => {
      assert(error instanceof AIProviderError);
      assert.equal(error.retryable, false);
      return true;
    });
    assert.equal(calls, 1);
  });
}
test('usage ausente permanece null e não inventa zero', async () => {
  const provider = new OpenAIProvider(configuration, async () =>
    json(body({ usage: null })),
  );
  assert.equal((await provider.generateResponse(request())).usage, null);
});
test('erro conserva tokens informados de resposta incompleta', async () => {
  const provider = new OpenAIProvider(configuration, async () =>
    json(body({ status: 'incomplete' })),
  );
  await assert.rejects(provider.generateResponse(request()), (error) => {
    fails('AI_INVALID_RESPONSE')(error);
    assert.equal((error as AIProviderError).usage?.totalTokens, 14);
    return true;
  });
});
test('logs só contêm métricas e falha de persistência não repete inferência', async (t) => {
  const logs: unknown[] = [];
  let calls = 0;
  const service = new AIService(
    {
      requirePermissions: async () => ({ tenantId: randomUUID() }),
    } as unknown as AuthorizationService,
    { resolve: configuration } as unknown as AIConfigResolver,
    {
      begin: async () => async () => {
        throw new Error('database secret');
      },
    } as unknown as AIUsageRepository,
    new FakeAIProvider((r) => {
      calls++;
      return {
        content: 'patient secret response',
        finishReason: 'completed',
        usage: null,
        model: r.modelConfig.model,
        provider: 'fake',
        latencyMs: 1,
        attempts: 1,
      };
    }),
  );
  const logger = (
    service as unknown as {
      logger: { log: (v: unknown) => void; error: (v: unknown) => void };
    }
  ).logger;
  t.mock.method(logger, 'log', (v: unknown) => logs.push(v));
  t.mock.method(logger, 'error', (v: unknown) => logs.push(v));
  const response = await service.generateResponse({
    systemInstructions: 'private instruction',
    messages: [{ role: 'USER', content: env.OPENAI_API_KEY }],
  });
  assert.equal(response.content, 'patient secret response');
  assert.equal(calls, 1);
  const serialized = JSON.stringify(logs);
  for (const secret of [
    env.OPENAI_API_KEY,
    'patient secret',
    'private instruction',
    'database secret',
  ])
    assert(!serialized.includes(secret));
});
test('fronteiras: SDK apenas no adaptador; provider sem banco, repositories, WhatsApp ou ações', () => {
  const source = readFileSync('src/ai/openai.provider.ts', 'utf8');
  assert(
    !/Prisma|Repository|Appointment|WhatsApp|@atendente\/database/.test(source),
  );
  for (const file of readdirSync('src/ai').filter(
    (f) => f.endsWith('.ts') && f !== 'openai.provider.ts',
  ))
    assert(!/from ['"]openai/.test(readFileSync(`src/ai/${file}`, 'utf8')));
  const example = readFileSync('../../.env.example', 'utf8');
  assert.match(example, /^OPENAI_API_KEY=\s*$/m);
  assert.match(example, /^OPENAI_MODEL=/m);
});

test('fronteira HTTP sanitiza novamente; chave não entra no corpo e temperature é omitida por padrão', async () => {
  const r = request();
  r.messages = [
    {
      role: 'USER',
      content: `Credencial ${env.OPENAI_API_KEY} senha=confidencial`,
    },
  ];
  const provider = new OpenAIProvider(configuration, async (_, init) => {
    assert(!String(init?.body).includes(env.OPENAI_API_KEY));
    assert(!String(init?.body).includes('confidencial'));
    assert.equal(JSON.parse(String(init?.body)).temperature, undefined);
    return json(body());
  });
  await provider.generateResponse(r);
});
test('JSON válido é retornado como dado sem executar comandos', async () => {
  const r = request();
  r.responseFormat = {
    type: 'json_schema',
    name: 'answer',
    schema: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
      additionalProperties: false,
    },
  };
  const provider = new OpenAIProvider(configuration, async () =>
    json(
      body({
        output: [
          {
            type: 'message',
            content: [
              { type: 'output_text', text: '{"command":"delete all"}' },
            ],
          },
        ],
      }),
    ),
  );
  assert.equal(
    (await provider.generateResponse(r)).content,
    '{"command":"delete all"}',
  );
});
test('recusa sem conteúdo útil é erro controlado sem retry', async () => {
  let calls = 0;
  const provider = new OpenAIProvider(configuration, async () => {
    calls++;
    return json(
      body({
        output: [
          { type: 'message', content: [{ type: 'refusal', refusal: 'no' }] },
        ],
      }),
    );
  });
  await assert.rejects(
    provider.generateResponse(request()),
    fails('AI_INVALID_RESPONSE'),
  );
  assert.equal(calls, 1);
});
test('configuração ausente falha no primeiro uso sem rede', async () => {
  let calls = 0;
  const provider = new OpenAIProvider(
    () => readAIConfiguration({}),
    async () => {
      calls++;
      return json(body());
    },
  );
  await assert.rejects(
    provider.generateResponse(request()),
    fails('AI_CONFIG_ERROR'),
  );
  assert.equal(calls, 0);
});
test('timeout também cobre corpo HTTP que nunca termina', async () => {
  const provider = new OpenAIProvider(
    () => ({ ...configuration(), timeoutMs: 10, maxRetries: 0 }),
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{'));
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
  await assert.rejects(
    provider.generateResponse(request()),
    fails('AI_TIMEOUT'),
  );
});
test('limites de contexto, roles e correlation rejeitam entradas indevidas', () => {
  for (const value of [
    {
      systemInstructions: 'A',
      messages: [],
      correlationId: 'sensitive-correlation',
    },
    { systemInstructions: 'A'.repeat(32001), messages: [] },
    {
      systemInstructions: 'A',
      messages: Array.from({ length: 41 }, () => ({
        role: 'USER',
        content: 'A',
      })),
    },
    {
      systemInstructions: 'A',
      messages: [{ role: 'USER', content: 'A', token: 'secret' }],
    },
  ])
    assert.throws(() => prepareAIInput(value), fails('AI_BAD_REQUEST'));
});

test('JSON Schema de saída preserva limites numéricos e rejeita segredos', () => {
  assert.doesNotThrow(() =>
    prepareAIInput({
      systemInstructions: 'A',
      messages: [],
      responseFormat: engineResponseFormat,
    }),
  );
  const toolDefinitions = JSON.stringify(
    new ToolRegistry()
      .definitions()
      .filter((tool) => CONVERSATION_ENGINE_CAPABILITIES.includes(tool.name)),
  );
  assert.equal(sanitizeAIText(toolDefinitions, [], 32000), toolDefinitions);
  assert.doesNotThrow(() =>
    prepareAIInput({
      systemInstructions: toolDefinitions,
      messages: [],
      responseFormat: engineResponseFormat,
    }),
  );
  assert.throws(
    () =>
      prepareAIInput({
        systemInstructions: 'A',
        messages: [],
        responseFormat: {
          type: 'json_schema',
          name: 'unsafe',
          schema: { type: 'object', api_key: 'fixture-value' },
        },
      }),
    fails('AI_BAD_REQUEST'),
  );
});

test('credenciais serializadas em texto JSON também são redigidas', () => {
  const prepared = prepareAIInput({
    systemInstructions: 'A',
    messages: [
      {
        role: 'USER',
        content:
          '{"passwordHash":"private-hash","access_token":"private-token","client_secret":"private-secret","api_key":"private-key"}',
      },
    ],
  });
  assert(!JSON.stringify(prepared).includes('private-'));
});
