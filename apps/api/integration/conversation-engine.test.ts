import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ContextIdFactory } from '@nestjs/core';
import { createDatabaseClient } from '@atendente/database';
import { createApplication } from '../src/bootstrap';
import type { DatabaseService } from '../src/auth/database.service';
import { AuthorizationService } from '../src/permissions/authorization.service';
import { ToolGateway } from '../src/tools/tool-gateway.service';
import type { ConversationEngineConfig } from '../src/conversation-engine/conversation-engine.config';
import { ConversationEngineRepository } from '../src/conversation-engine/conversation-engine.repository';

const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).pathname !== '/task002_test' ||
  connection !== process.env.DATABASE_URL
)
  throw new Error('Use pnpm db:test.');

const finalOutput = {
  intent: 'INFORMATION' as const,
  confidence: 0.9,
  response: 'Resposta persistida.',
  waitingForPatient: true,
  handoffReason: null,
  summary: 'Resumo mínimo.',
  toolCalls: [],
};

test('Conversation Engine: tenant, lease, ordem, recuperação e resposta idempotente no PostgreSQL', async () => {
  const client = createDatabaseClient(connection);
  const app = await createApplication();
  const repository = new ConversationEngineRepository(
    { client } as DatabaseService,
    {
      historyLimit: 2,
      maxIterations: 5,
      maxToolCalls: 8,
      timeoutMs: 30000,
      leaseMs: 45000,
      minimumConfidence: 0.6,
    } as ConversationEngineConfig,
  );
  try {
    const tenantA = await client.tenant.create({
      data: {
        name: 'Engine tenant A',
        status: 'ACTIVE',
        timezone: 'America/Sao_Paulo',
      },
    });
    const tenantB = await client.tenant.create({
      data: { name: 'Engine tenant B', status: 'ACTIVE', timezone: 'UTC' },
    });
    const contactA = await client.contact.create({
      data: { tenantId: tenantA.id, displayName: 'Contato A' },
    });
    const contactB = await client.contact.create({
      data: { tenantId: tenantB.id, displayName: 'Contato B' },
    });
    const conversationA = await client.conversation.create({
      data: {
        tenantId: tenantA.id,
        contactId: contactA.id,
        status: 'WAITING_PATIENT',
      },
    });
    const conversationB = await client.conversation.create({
      data: { tenantId: tenantB.id, contactId: contactB.id },
    });
    const inbound = async (
      tenantId: string,
      conversationId: string,
      content: string,
      createdAt: Date,
    ) => {
      const message = await client.message.create({
        data: {
          tenantId,
          conversationId,
          channel: 'WHATSAPP',
          senderType: 'PATIENT',
          messageType: 'TEXT',
          deliveryStatus: 'LOCAL',
          content,
          createdAt,
        },
      });
      const run = await client.aIProcessingRun.create({
        data: {
          tenantId,
          conversationId,
          inboundMessageId: message.id,
          correlationId: randomUUID(),
        },
      });
      return {
        message,
        run,
        job: { tenantId, conversationId, messageId: message.id, runId: run.id },
      };
    };

    const a1 = await inbound(
      tenantA.id,
      conversationA.id,
      'primeira',
      new Date('2026-10-09T10:00:00Z'),
    );
    const a2 = await inbound(
      tenantA.id,
      conversationA.id,
      'segunda',
      new Date('2026-10-09T10:00:01Z'),
    );
    const b1 = await inbound(
      tenantB.id,
      conversationB.id,
      'mesmo fluxo isolado',
      new Date('2026-10-09T10:00:00Z'),
    );

    await assert.rejects(() =>
      repository.claim({ ...a1.job, tenantId: tenantB.id }, randomUUID()),
    );

    const [first, duplicate] = await Promise.all([
      repository.claim(a1.job, randomUUID()),
      repository.claim(a1.job, randomUUID()),
    ]);
    const claimed = first.outcome === 'claimed' ? first : duplicate;
    const deferred = first.outcome === 'deferred' ? first : duplicate;
    assert.equal(claimed.outcome, 'claimed');
    assert.equal(deferred.outcome, 'deferred');
    if (claimed.outcome !== 'claimed') throw new Error('claim esperado');
    assert.equal(claimed.context.messages.length, 1);
    assert.equal(claimed.context.messages.at(-1)?.content, 'primeira');
    assert.equal(
      (
        await client.conversation.findUniqueOrThrow({
          where: { id: conversationA.id },
        })
      ).status,
      'AI_ACTIVE',
    );

    const later = await repository.claim(a2.job, randomUUID());
    assert.equal(later.outcome, 'deferred');

    const requestContext = ContextIdFactory.create();
    app.registerRequestByContextId(Object.freeze({}), requestContext);
    const authorization = await app.resolve(
      AuthorizationService,
      requestContext,
      { strict: false },
    );
    const gateway = await app.resolve(ToolGateway, requestContext, {
      strict: false,
    });
    await authorization.runAsConversationEngine(claimed.grant, async () => {
      const turn = await gateway.beginTurn({
        conversationId: conversationA.id,
        actorType: 'AI',
        correlationId: claimed.grant.correlationId,
      });
      const read = await gateway.executeTool(
        { name: 'list_services', callId: 'engine_read', arguments: {} },
        turn,
      );
      assert.equal(read.success, true);
      const mutation = await gateway.executeTool(
        {
          name: 'create_hold',
          callId: 'engine_mutation',
          arguments: {
            serviceId: randomUUID(),
            providerId: randomUUID(),
            unitId: randomUUID(),
            startAt: '2026-10-10T10:00:00Z',
          },
        },
        turn,
      );
      assert.equal(mutation.error?.code, 'INVALID_RELATIONSHIP');
    });

    const parallelTenant = await repository.claim(b1.job, randomUUID());
    assert.equal(parallelTenant.outcome, 'claimed');

    const notices = await repository.complete(claimed.grant, finalOutput, 0);
    assert.equal(notices[0]?.type, 'message.created');
    const completed = await client.aIProcessingRun.findUniqueOrThrow({
      where: { id: a1.run.id },
      include: { responseMessage: true },
    });
    assert.equal(completed.status, 'COMPLETED');
    assert.equal(completed.responseMessage?.content, 'Resposta persistida.');
    assert.equal(completed.responseMessage?.senderType, 'AI');
    assert.equal(completed.responseMessage?.deliveryStatus, 'LOCAL');
    assert.equal(
      (
        await client.conversation.findUniqueOrThrow({
          where: { id: conversationA.id },
        })
      ).status,
      'WAITING_PATIENT',
    );
    await assert.rejects(() =>
      repository.complete(claimed.grant, finalOutput, 0),
    );
    assert.equal(
      await client.message.count({
        where: {
          tenantId: tenantA.id,
          conversationId: conversationA.id,
          senderType: 'AI',
        },
      }),
      1,
    );

    await client.aIProcessingRun.update({
      where: { id: a2.run.id },
      data: { status: 'PROCESSING', updatedAt: new Date(0) },
    });
    await client.conversationEngineLease.upsert({
      where: {
        tenantId_conversationId: {
          tenantId: tenantA.id,
          conversationId: conversationA.id,
        },
      },
      create: {
        tenantId: tenantA.id,
        conversationId: conversationA.id,
        ownerId: randomUUID(),
        expiresAt: new Date(0),
      },
      update: { ownerId: randomUUID(), expiresAt: new Date(0) },
    });
    const recovered = await repository.claim(a2.job, randomUUID());
    assert.equal(recovered.outcome, 'claimed');

    await client.conversation.update({
      where: { id: conversationB.id },
      data: {
        status: 'NEEDS_HUMAN',
        handoffReason: 'OTHER',
        handoffRequestedAt: new Date(),
      },
    });
    if (parallelTenant.outcome !== 'claimed') throw new Error('claim esperado');
    await repository.handoff(
      parallelTenant.grant,
      'SYSTEM_ERROR',
      null,
      0,
      'ENGINE_STATE_CHANGED',
    );
    assert.equal(
      (
        await client.conversation.findUniqueOrThrow({
          where: { id: conversationB.id },
        })
      ).status,
      'NEEDS_HUMAN',
    );
  } finally {
    await app.close();
    await client.$disconnect();
  }
});
