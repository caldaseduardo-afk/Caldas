import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  sanitizeAudit,
  recordAudit,
  auditActorContext,
  type Prisma,
} from '@atendente/database';
import { auditQuery } from '../src/audit/audit.dto';
test('audit sanitizer redige chaves sensíveis recursivamente, limita tamanho e preserva campos normais', () => {
  const secrets = [
    'password_hash',
    'access_token',
    'refresh_token',
    'api_key',
    'authorization',
    'cookie',
    'sessionToken',
    'googleOAuthSecret',
    'prompt',
    'content',
    'tool_arguments',
  ];
  const input = Object.fromEntries(secrets.map((k) => [k, 'segredo']));
  const result = sanitizeAudit({
    ...input,
    status: 'CONFIRMED',
    nested: [{ ...input, version: 2 }],
  });
  assert.deepEqual(result, { status: 'CONFIRMED', nested: [{ version: 2 }] });
  assert(!JSON.stringify(result).includes('segredo'));
  assert.equal((sanitizeAudit('a'.repeat(2000)) as string).length, 1000);
});
test('audit query rejeita tenant/ator falsificado, filtros inválidos e paginação sem limite', () => {
  for (const value of [
    { tenantId: randomUUID() },
    { actor_user_id: randomUUID() },
    { limit: 101 },
    { page: 0 },
    { action: 'SQL' },
    { dateFrom: '2030-01-02T00:00:00Z', dateTo: '2030-01-01T00:00:00Z' },
  ])
    assert.throws(() => auditQuery(value));
  assert.equal(auditQuery({}).limit, 25);
  assert.equal(auditQuery({ limit: '5' }).limit, 5);
});
test('ator AI confiável substitui executor humano sem criar usuário fake e preserva correlação', async () => {
  let saved: Prisma.AuthEventUncheckedCreateInput | undefined;
  const tx = {
    authEvent: {
      create: async ({
        data,
      }: {
        data: Prisma.AuthEventUncheckedCreateInput;
      }) => {
        saved = data;
        return data;
      },
    },
  } as unknown as Prisma.TransactionClient;
  const tenantId = randomUUID(),
    correlationId = randomUUID();
  await auditActorContext.run(
    { tenantId, actorType: 'AI', source: 'AI_ENGINE', correlationId },
    () =>
      recordAudit(tx, {
        data: {
          tenantId,
          userId: randomUUID(),
          resourceId: randomUUID(),
          type: 'APPOINTMENT_CANCELLED',
          changes: { from: 'CONFIRMED', to: 'CANCELLED' },
        },
      }),
  );
  assert.equal(saved?.userId, null);
  assert.equal(saved?.actorType, 'AI');
  assert.equal(saved?.source, 'AI_ENGINE');
  assert.equal(saved?.correlationId, correlationId);
  assert.deepEqual(saved?.previousValues, { status: 'CONFIRMED' });
  assert.deepEqual(saved?.newValues, { status: 'CANCELLED' });
  assert.throws(
    () =>
      auditActorContext.run(
        { tenantId: randomUUID(), actorType: 'AI', source: 'AI_ENGINE' },
        () =>
          recordAudit(tx, {
            data: {
              tenantId,
              resourceId: randomUUID(),
              type: 'APPOINTMENT_CANCELLED',
            },
          }),
      ),
    /TENANT_MISMATCH/,
  );
  assert.throws(
    () =>
      recordAudit(tx, {
        data: { type: 'APPOINTMENT_CREATED', resourceId: randomUUID() },
      }),
    /RESOURCE_REQUIRED/,
  );
});

test('nível de autorização é informação auditável e não header secreto', () => {
  assert.deepEqual(
    sanitizeAudit({
      authorizationLevel: 'FULL',
      authorization: 'Bearer secret',
      before: { authorizationLevel: 'NO_ACCESS' },
    }),
    { authorizationLevel: 'FULL', before: { authorizationLevel: 'NO_ACCESS' } },
  );
});
