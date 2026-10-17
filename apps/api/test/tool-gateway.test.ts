import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { z } from 'zod';
import {
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import {
  ToolGateway,
  toolFingerprint,
} from '../src/tools/tool-gateway.service';
import {
  ToolRegistry,
  schemas,
  AI_CAPABILITIES,
  TOOL_LIMITS,
} from '../src/tools/tool.schemas';
import { ToolExecutionError, safeToolError } from '../src/tools/tool.errors';
import type { ToolResult } from '../src/tools/tool.errors';
import type { AuthorizationService } from '../src/permissions/authorization.service';
import type { ToolContextRepository } from '../src/tools/tool-context.repository';
import type { ToolExecutionRepository } from '../src/tools/tool-execution.repository';
import type { ToolHandlers } from '../src/tools/tool.handlers';
const id = randomUUID;
function fixture() {
  const scope = { tenantId: id(), userId: id(), sessionId: id() };
  const conversation = {
    id: id(),
    contactId: id(),
    activePatientId: id(),
    channel: 'WHATSAPP',
    status: 'AI_ACTIVE',
  };
  const rows = new Map<
    string,
    {
      id: string;
      inputHash: string;
      actorId: string;
      actorType: string;
      patientId: string;
      status: string;
      result?: ToolResult;
    }
  >();
  let calls = 0;
  const auth = { requirePermissions: async () => scope };
  const contexts = {
    load: async () => conversation,
    validate: async () => conversation,
    target: async () => {},
  };
  const executions = {
    find: async (_: unknown, callId: string) => rows.get(callId),
    begin: async (
      _: unknown,
      _name: string,
      callId: string,
      inputHash: string,
    ) => {
      if (rows.has(callId)) throw new ToolExecutionError('CALL_IN_PROGRESS');
      const row = {
        id: id(),
        inputHash,
        actorId: scope.userId,
        actorType: 'AI',
        patientId: conversation.activePatientId,
        status: 'RUNNING',
      };
      rows.set(callId, row);
      return row;
    },
    complete: async (
      _: unknown,
      rowId: string,
      result: ToolResult,
      _ms: number,
      persist: boolean,
    ) => {
      const row = [...rows.values()].find((r) => r.id === rowId)!;
      row.status = result.success ? 'SUCCESS' : 'ERROR';
      if (persist) row.result = result;
    },
  };
  const handlers = {
    execute: async (): Promise<unknown> => {
      calls++;
      return [];
    },
  };
  const gateway = new ToolGateway(
    auth as unknown as AuthorizationService,
    contexts as unknown as ToolContextRepository,
    executions as unknown as ToolExecutionRepository,
    handlers as unknown as ToolHandlers,
    new ToolRegistry(),
  );
  return {
    gateway,
    handlers,
    auth,
    contexts,
    rows,
    conversation,
    scope,
    calls: () => calls,
    turn: () =>
      gateway.beginTurn({ conversationId: conversation.id, actorType: 'AI' }),
  };
}
const call = (name: string, args = {}, callId = id()) => ({
  name,
  arguments: args,
  callId,
});
test('registry explícito tem doze tools e JSON schemas derivados da validação', () => {
  const registry = new ToolRegistry();
  assert.equal(registry.definitions().length, 13);
  for (const definition of registry.definitions())
    assert.deepEqual(
      definition.inputSchema,
      z.toJSONSchema(schemas[definition.name].input),
    );
  for (const name of [
    'run_sql',
    'fetch_url',
    'execute_code',
    'shell',
    'constructor',
    '__proto__',
    'get_any_patient',
  ])
    assert.equal(registry.has(name), false);
  assert.equal(AI_CAPABILITIES.length, 13);
  assert(!AI_CAPABILITIES.some((n) => /billing|user|config/.test(n)));
});
test('campos perigosos, UUID/tipos inválidos e payload exagerado são rejeitados', async () => {
  const f = fixture(),
    turn = await f.turn();
  for (const input of [
    call('list_services', { tenantId: id() }),
    call('list_services', { specialtyId: 'invalid' }),
    call('list_services', { specialtyId: 1 }),
    call('transfer_to_human', { reason: 'OTHER', assignedUserId: id() }),
    call('create_hold', { patientId: id() }),
    call('list_services', { text: 'x'.repeat(9000) }),
  ]) {
    assert.equal(
      (await f.gateway.executeTool(input, turn)).error?.code,
      'INVALID_ARGUMENTS',
    );
  }
  assert.equal(f.calls(), 0);
});
test('tool inexistente e contexto forjado falham sem executar handler', async () => {
  const f = fixture();
  assert.equal(
    (await f.gateway.executeTool(call('run_sql'), await f.turn())).error?.code,
    'TOOL_NOT_FOUND',
  );
  assert.equal(
    (await f.gateway.executeTool(call('list_services'), { id: id() })).error
      ?.code,
    'UNAUTHORIZED',
  );
  assert.equal(f.calls(), 0);
});
test('callId preservado, resultado tipado e limites por turno', async () => {
  const f = fixture(),
    turn = await f.turn(),
    c = call('list_services');
  const result = await f.gateway.executeTool(c, turn);
  assert(result.success);
  assert.equal(result.callId, c.callId);
  assert.deepEqual(result.data, []);
  for (let i = 1; i < TOOL_LIMITS.callsPerTurn; i++)
    assert((await f.gateway.executeTool(call('list_services'), turn)).success);
  assert.equal(
    (await f.gateway.executeTool(call('list_services'), turn)).error?.code,
    'TOOL_LIMIT_EXCEEDED',
  );
});
test('mudança de tenant da sessão invalida contexto emitido anteriormente', async () => {
  const f = fixture(),
    turn = await f.turn();
  f.scope.tenantId = id();
  assert.equal(
    (await f.gateway.executeTool(call('list_services'), turn)).error?.code,
    'FORBIDDEN',
  );
  assert.equal(f.calls(), 0);
});
test('autorização humana é aplicada também ao ator AI e não há bypass', async () => {
  const f = fixture(),
    turn = await f.turn();
  f.auth.requirePermissions = async () => {
    throw new ForbiddenException('secret');
  };
  const result = await f.gateway.executeTool(call('list_services'), turn);
  assert.equal(result.error?.code, 'FORBIDDEN');
  assert(!JSON.stringify(result).includes('secret'));
});
test('mutações de consulta exigem aprovação confiável do payload exato', async () => {
  const f = fixture();
  const args = { appointmentId: id() };
  const turn = await f.gateway.beginTurn({
    conversationId: f.conversation.id,
    actorType: 'AI',
    approvedMutations: [{ name: 'cancel_appointment', arguments: args }],
  });
  assert.equal(
    (
      await f.gateway.executeTool(
        call('cancel_appointment', { appointmentId: id() }),
        turn,
      )
    ).error?.code,
    'CONFIRMATION_REQUIRED',
  );
  assert.equal(f.calls(), 0);
});
test('fingerprint estável não depende da ordem dos campos', () => {
  assert.equal(
    toolFingerprint('create_hold', { a: 1, b: 2 }),
    toolFingerprint('create_hold', { b: 2, a: 1 }),
  );
  assert.notEqual(
    toolFingerprint('create_hold', { a: 1 }),
    toolFingerprint('cancel_appointment', { a: 1 }),
  );
});
test('replay mutável e corrida não executam novamente; alteração de payload conflita', async () => {
  const f = fixture();
  const args = {
    serviceId: id(),
    providerId: id(),
    unitId: id(),
    startAt: '2035-01-01T10:00:00Z',
  };
  let calls = 0;
  f.handlers.execute = async () => {
    calls++;
    return {
      holdId: id(),
      startAt: args.startAt,
      endAt: '2035-01-01T11:00:00Z',
      expiresAt: '2030-01-01T00:00:00Z',
      status: 'ACTIVE',
    };
  };
  const c = call('create_hold', args),
    turn = await f.turn();
  const results = await Promise.all([
    f.gateway.executeTool(c, turn),
    f.gateway.executeTool(c, turn),
  ]);
  assert.equal(calls, 1);
  assert(results.some((r) => r.success));
  const replay = await f.gateway.executeTool(c, turn);
  assert.deepEqual(
    replay,
    results.find((r) => r.success),
  );
  assert.equal(
    (
      await f.gateway.executeTool(
        { ...c, arguments: { ...args, unitId: id() } },
        turn,
      )
    ).error?.code,
    'IDEMPOTENCY_CONFLICT',
  );
});
test('erro interno/output inválido não vazam dados e sucesso/falha geram ledger', async () => {
  const f = fixture();
  f.handlers.execute = async () => {
    throw new Error('SQL secret password');
  };
  const result = await f.gateway.executeTool(
    call('list_services'),
    await f.turn(),
  );
  assert.equal(result.error?.code, 'INTERNAL_ERROR');
  assert(!JSON.stringify(result).includes('SQL'));
  assert.equal([...f.rows.values()][0].status, 'ERROR');
  f.handlers.execute = async () => [
    { id: id(), name: 'A', durationMinutes: 10, secret: 'private' },
  ];
  assert.equal(
    (await f.gateway.executeTool(call('list_services'), await f.turn())).error
      ?.code,
    'INTERNAL_ERROR',
  );
});
test('logs não contêm argumentos ou secrets', async (t) => {
  const f = fixture();
  const messages: unknown[] = [];
  const logger = (
    f.gateway as unknown as { logger: { log: (value: unknown) => void } }
  ).logger;
  t.mock.method(logger, 'log', (value: unknown) => messages.push(value));
  await f.gateway.executeTool(
    call('cancel_appointment', { appointmentId: id(), reason: 'token=SECRET' }),
    await f.turn(),
  );
  assert(!JSON.stringify(messages).includes('SECRET'));
  assert(!JSON.stringify(messages).includes('arguments'));
});
test('erros de negócio são padronizados sem mensagens internas', () => {
  assert.equal(
    safeToolError(new NotFoundException('other tenant'), 'get_appointment')
      .code,
    'RESOURCE_NOT_FOUND',
  );
  assert.equal(
    safeToolError(new ConflictException('SQL details'), 'create_hold').code,
    'SLOT_UNAVAILABLE',
  );
  assert.equal(
    safeToolError(new ToolExecutionError('HOLD_EXPIRED'), 'confirm_appointment')
      .code,
    'HOLD_EXPIRED',
  );
});
test('timeout é limitado e RUNNING não permite novo despacho', async () => {
  const f = fixture();
  f.handlers.execute = async () => new Promise(() => {});
  const c = call('create_hold', {
      serviceId: id(),
      providerId: id(),
      unitId: id(),
      startAt: '2035-01-01T10:00:00Z',
    }),
    turn = await f.turn();
  const result = await f.gateway.executeTool(c, turn);
  assert.equal(result.error?.code, 'TOOL_TIMEOUT');
  assert.equal([...f.rows.values()][0].status, 'RUNNING');
  assert.equal(
    (await f.gateway.executeTool(c, turn)).error?.code,
    'CALL_IN_PROGRESS',
  );
});
test('handlers não importam Prisma/SQL/SDK, gateway não tem endpoint ou eval', () => {
  const handlers = readFileSync('src/tools/tool.handlers.ts', 'utf8');
  assert(!/Prisma|\$queryRaw|openai|eval\(/.test(handlers));
  assert(
    !/@Controller|@Post|eval\(|fetch\(/.test(
      readFileSync('src/tools/tool-gateway.service.ts', 'utf8'),
    ),
  );
});

test('timeout inclui autorização; operação atrasada não chega ao handler', async () => {
  const f = fixture(),
    turn = await f.turn();
  const original = f.auth.requirePermissions;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.auth.requirePermissions = async () => {
    await blocked;
    return original();
  };
  const configuration = (
    f.gateway as unknown as {
      config: {
        limits: {
          toolTimeoutMs: number;
          callsPerTurn: number;
          turnTimeoutMs: number;
          payloadBytes: number;
        };
      };
    }
  ).config;
  configuration.limits = { ...configuration.limits, toolTimeoutMs: 100 };
  assert.equal(
    (await f.gateway.executeTool(call('list_services'), turn)).error?.code,
    'TOOL_TIMEOUT',
  );
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(f.calls(), 0);
});

test('resultado de leitura é bloqueado se contexto revogar após service retornar', async () => {
  const f = fixture();
  let checks = 0;
  f.contexts.validate = async () => {
    if (++checks > 1) throw new ToolExecutionError('INVALID_RELATIONSHIP');
    return f.conversation;
  };
  const result = await f.gateway.executeTool(
    call('list_services'),
    await f.turn(),
  );
  assert.equal(result.error?.code, 'INVALID_RELATIONSHIP');
  assert.equal(result.data, undefined);
});
