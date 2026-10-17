import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createDatabaseClient } from '@atendente/database';
import type { DatabaseService } from '../src/auth/database.service';
import type { AuthorizationService } from '../src/permissions/authorization.service';
import { AIConfigurationRepository } from '../src/ai-configuration/ai-configuration.repository';
import { AIConfigurationSimulationService } from '../src/ai-configuration/ai-configuration.simulation';
import { AIPromptComposer } from '../src/ai-configuration/ai-prompt-composer.service';
const url = process.env.DATABASE_URL;
const input = (name: string, basedOnVersionId?: string) => ({
  assistantName: name,
  tone: 'FRIENDLY' as const,
  greeting: `Olá, sou ${name}`,
  systemInstructions: 'Responda somente questões administrativas.',
  allowedContent: ['CLINIC_INFORMATION' as const],
  enabledCapabilities: ['KNOWLEDGE' as const, 'HANDOFF' as const],
  knowledgeEnabled: true,
  handoffPaymentNegotiation: true,
  handoffKnowledgeMiss: true,
  model: 'test-model',
  temperature: 0.2,
  maxOutputTokens: 500,
  confidenceThreshold: 0.6,
  basedOnVersionId,
});
test(
  'AI config E2E: tenant, draft invisível, publicação, concorrência e restauração imutável',
  { skip: !url },
  async () => {
    const client = createDatabaseClient(url!);
    const marker = randomUUID().slice(0, 8);
    const ids = {
      a: randomUUID(),
      b: randomUUID(),
      ua: randomUUID(),
      ub: randomUUID(),
      sa: randomUUID(),
      sb: randomUUID(),
    };
    const auth = (tenantId: string, userId: string, sessionId: string) =>
      ({
        requirePermissions: async () => ({ tenantId, userId, sessionId }),
      }) as unknown as AuthorizationService;
    const db = { client } as unknown as DatabaseService;
    try {
      for (const p of ['settings.view', 'settings.manage', 'ai_config.publish'])
        await client.permission.upsert({
          where: { name: p },
          create: { name: p },
          update: {},
        });
      await client.role.upsert({
        where: { name: 'CLINIC_ADMIN' },
        create: { name: 'CLINIC_ADMIN', enabled: true },
        update: { enabled: true },
      });
      for (const permissionName of [
        'settings.view',
        'settings.manage',
        'ai_config.publish',
      ])
        await client.rolePermission.upsert({
          where: {
            roleName_permissionName: {
              roleName: 'CLINIC_ADMIN',
              permissionName,
            },
          },
          create: { roleName: 'CLINIC_ADMIN', permissionName },
          update: {},
        });
      await client.tenant.createMany({
        data: [
          {
            id: ids.a,
            name: `A-${marker}`,
            status: 'ACTIVE',
            timezone: 'America/Sao_Paulo',
          },
          {
            id: ids.b,
            name: `B-${marker}`,
            status: 'ACTIVE',
            timezone: 'America/Sao_Paulo',
          },
        ],
      });
      await client.user.createMany({
        data: [
          {
            id: ids.ua,
            email: `a-${marker}@test.local`,
            name: 'A',
            passwordHash: 'x',
          },
          {
            id: ids.ub,
            email: `b-${marker}@test.local`,
            name: 'B',
            passwordHash: 'x',
          },
        ],
      });
      await client.userTenant.createMany({
        data: [
          { tenantId: ids.a, userId: ids.ua, role: 'CLINIC_ADMIN' },
          { tenantId: ids.b, userId: ids.ub, role: 'CLINIC_ADMIN' },
        ],
      });
      await client.authSession.createMany({
        data: [
          {
            id: ids.sa,
            userId: ids.ua,
            activeTenantId: ids.a,
            tokenHash: 'c'.repeat(64),
            expiresAt: new Date(Date.now() + 60000),
          },
          {
            id: ids.sb,
            userId: ids.ub,
            activeTenantId: ids.b,
            tokenHash: 'd'.repeat(64),
            expiresAt: new Date(Date.now() + 60000),
          },
        ],
      });
      const a = new AIConfigurationRepository(db, auth(ids.a, ids.ua, ids.sa));
      const b = new AIConfigurationRepository(db, auth(ids.b, ids.ub, ids.sb));
      const v1 = await a.create(input('Clara'));
      assert.equal(await a.production(), null);
      const simulated = await new AIConfigurationSimulationService(
        a,
        {
          generateResponse: async () => ({
            content: JSON.stringify({
              intent: 'INFORMATION',
              confidence: 0.9,
              response: 'Olá, sou Clara.',
              waitingForPatient: true,
              handoffReason: null,
              summary: 'saudação',
              scheduling: null,
              toolCalls: [],
            }),
            provider: 'fake',
            model: 'test-model',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            latencyMs: 1,
            attempts: 1,
            finishReason: 'stop',
          }),
        } as never,
        { definitions: () => [] } as never,
        new AIPromptComposer(),
        { search: async () => ({ knowledgeFound: false, results: [] }) },
      ).simulate(v1.id, { message: 'Olá' });
      assert.equal(simulated.response, 'Olá, sou Clara.');
      assert.equal(simulated.sideEffectsExecuted, false);
      assert.equal(await a.production(), null);
      const p1 = await a.publish(v1.id, v1.updatedAt.toISOString());
      assert.equal((await a.production())?.assistantName, 'Clara');
      await assert.rejects(b.find(p1.id), /não encontrado/);
      const overview = await a.overview();
      assert.notEqual(overview.id, null);
      if (!('updatedAt' in overview)) throw new Error('missing configuration');
      const v2 = await a.cloneActive(overview.updatedAt!.toISOString());
      const changed = await a.update(v2.id, {
        expectedUpdatedAt: v2.updatedAt.toISOString(),
        assistantName: 'Clara Formal',
        tone: 'FORMAL',
      });
      await assert.rejects(
        a.update(v2.id, {
          expectedUpdatedAt: v2.updatedAt.toISOString(),
          greeting: 'perdida',
        }),
        /alterado por outro usuário/,
      );
      assert.equal((await a.production())?.assistantName, 'Clara');
      const p2 = await a.publish(v2.id, changed.updatedAt.toISOString());
      assert.equal((await a.production())?.assistantName, 'Clara Formal');
      const restored = await a.restore(p1.id);
      assert.equal(restored.versionNumber, 3);
      assert.equal(restored.assistantName, 'Clara');
      assert.equal(restored.basedOnVersionId, p1.id);
      assert.equal((await a.production())?.id, restored.id);
      assert.equal((await a.list()).length, 3);
      assert.equal(
        await client.authEvent.count({
          where: {
            tenantId: ids.a,
            type: {
              in: [
                'AI_CONFIG_VERSION_CREATED',
                'AI_CONFIG_VERSION_UPDATED',
                'AI_CONFIG_PUBLISHED',
                'AI_CONFIG_RESTORED',
                'AI_CONFIG_SIMULATED',
              ],
            },
          },
        }),
        7,
      );
      assert.notEqual(p2.id, restored.id);
    } finally {
      await client.aIConfiguration.updateMany({
        where: { tenantId: { in: [ids.a, ids.b] } },
        data: { activeVersionId: null },
      });
      await client.aIConfigurationVersion.deleteMany({
        where: { tenantId: { in: [ids.a, ids.b] } },
      });
      await client.aIConfiguration.deleteMany({
        where: { tenantId: { in: [ids.a, ids.b] } },
      });
      await client.authEvent.deleteMany({
        where: { tenantId: { in: [ids.a, ids.b] } },
      });
      await client.userTenant.deleteMany({
        where: { tenantId: { in: [ids.a, ids.b] } },
      });
      await client.user.deleteMany({ where: { id: { in: [ids.ua, ids.ub] } } });
      await client.tenant.deleteMany({ where: { id: { in: [ids.a, ids.b] } } });
      await client.$disconnect();
    }
  },
);
