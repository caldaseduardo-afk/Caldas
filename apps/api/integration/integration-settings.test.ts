import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { ContextIdFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  createDatabaseClient,
  decryptTenantCredential,
} from '@atendente/database';
import { AIProviderError } from '@atendente/domain';
import { AIConfigResolver } from '../src/ai/ai.config';
import { IntegrationSettingsModule } from '../src/integration-settings/integration-settings.module';
import { IntegrationSettingsService } from '../src/integration-settings/integration-settings.service';
import { DatabaseService } from '../src/auth/database.service';
import type { AuthRequest } from '../src/auth/auth.guard';

const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).pathname !== '/task002_test' ||
  connection !== process.env.DATABASE_URL
)
  throw new Error('Use pnpm db:test.');

test('clinic integration credentials are encrypted, tenant-scoped, and never returned', async (t) => {
  const previous = Object.fromEntries(
    [
      'TENANT_CREDENTIALS_KEY',
      'OPENAI_MODEL',
      'OPENAI_BASE_URL',
      'OPENAI_TIMEOUT_MS',
      'OPENAI_MAX_OUTPUT_TOKENS',
      'OPENAI_API_KEY',
    ].map((name) => [name, process.env[name]]),
  );
  process.env.TENANT_CREDENTIALS_KEY ??= Buffer.alloc(32, 4).toString('base64');
  process.env.OPENAI_MODEL = 'test-model';
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';
  process.env.OPENAI_TIMEOUT_MS = '1000';
  process.env.OPENAI_MAX_OUTPUT_TOKENS = '256';
  process.env.OPENAI_API_KEY = 'sk-global-should-not-be-used';
  const client = createDatabaseClient(connection);
  const module = await Test.createTestingModule({
    imports: [IntegrationSettingsModule],
  })
    .overrideProvider(DatabaseService)
    .useValue({ client })
    .compile();

  async function fixture(role = 'CLINIC_ADMIN') {
    const tenant = await client.tenant.create({
      data: { name: 'Credential test', status: 'ACTIVE', timezone: 'UTC' },
    });
    const user = await client.user.create({
      data: {
        email: `${randomUUID()}@credentials.test`,
        name: 'Credential fixture',
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
    const context = ContextIdFactory.create();
    module.registerRequestByContextId(
      {
        identity: { id: user.id, email: user.email, name: user.name },
        sessionId: session.id,
        activeTenantId: tenant.id,
      } as unknown as AuthRequest,
      context,
    );
    return {
      tenant,
      service: await module.resolve(IntegrationSettingsService, context),
    };
  }

  try {
    const clinicA = await fixture();
    const clinicB = await fixture();
    const agent = await fixture('AGENT');
    const openAiKey = 'sk-test-clinic-a-secret-value-123456';
    const whatsappToken = 'whatsapp-clinic-a-secret-token-123456';

    await clinicA.service.configure({
      openAiApiKey: openAiKey,
      whatsapp: {
        accessToken: whatsappToken,
        phoneNumberId: '12345678901',
        businessAccountId: '23456789012',
      },
    });

    const clinicASettings = await clinicA.service.get();
    const clinicBSettings = await clinicB.service.get();
    assert.equal(clinicASettings.openAi.configured, true);
    assert.equal(clinicASettings.whatsapp.configured, true);
    assert.equal(clinicBSettings.openAi.configured, false);
    assert.equal(clinicBSettings.whatsapp.configured, false);
    assert.equal(JSON.stringify(clinicASettings).includes(openAiKey), false);
    assert.equal(
      JSON.stringify(clinicASettings).includes(whatsappToken),
      false,
    );

    const resolver = new AIConfigResolver({ client } as DatabaseService);
    assert.equal((await resolver.resolve(clinicA.tenant.id)).apiKey, openAiKey);
    await assert.rejects(
      resolver.resolve(clinicB.tenant.id),
      (error: unknown) => error instanceof AIProviderError,
    );

    const storedAI = await client.aIProviderCredential.findUniqueOrThrow({
      where: { tenantId: clinicA.tenant.id },
    });
    assert.notEqual(storedAI.ciphertext, openAiKey);
    assert.equal(
      decryptTenantCredential(storedAI, clinicA.tenant.id, 'OPENAI_API_KEY'),
      openAiKey,
    );
    const storedWhatsApp = await client.integration.findFirstOrThrow({
      where: { tenantId: clinicA.tenant.id },
    });
    assert.notEqual(storedWhatsApp.credentialCiphertext, whatsappToken);

    await assert.rejects(
      agent.service.configure({
        openAiApiKey: 'sk-test-agent-key-value-123456',
      }),
      ForbiddenException,
    );
    await t.test(
      'configuration responses do not include encrypted envelope',
      async () => {
        assert.equal('ciphertext' in (clinicASettings as object), false);
        assert.equal('credentialCiphertext' in clinicASettings.whatsapp, false);
      },
    );
  } finally {
    await module.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
