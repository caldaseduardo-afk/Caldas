import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  decryptTenantCredential,
  encryptTenantCredential,
  resolveIntegrationAccessToken,
} from '../src/tenant-credentials';

test('tenant credentials use authenticated encryption scoped to tenant and resource', () => {
  const previous = process.env.TENANT_CREDENTIALS_KEY;
  process.env.TENANT_CREDENTIALS_KEY = Buffer.alloc(32, 7).toString('base64');
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const integrationId = randomUUID();
  const encrypted = encryptTenantCredential(
    'secret-token-value',
    tenantA,
    'WHATSAPP_ACCESS_TOKEN',
    integrationId,
  );
  assert.equal(
    decryptTenantCredential(
      encrypted,
      tenantA,
      'WHATSAPP_ACCESS_TOKEN',
      integrationId,
    ),
    'secret-token-value',
  );
  assert.throws(() =>
    decryptTenantCredential(
      encrypted,
      tenantB,
      'WHATSAPP_ACCESS_TOKEN',
      integrationId,
    ),
  );
  assert.throws(() =>
    decryptTenantCredential(
      encrypted,
      tenantA,
      'WHATSAPP_ACCESS_TOKEN',
      randomUUID(),
    ),
  );
  assert.throws(() =>
    decryptTenantCredential(
      { ...encrypted, ciphertext: Buffer.from('altered').toString('base64') },
      tenantA,
      'WHATSAPP_ACCESS_TOKEN',
      integrationId,
    ),
  );
  if (previous === undefined) delete process.env.TENANT_CREDENTIALS_KEY;
  else process.env.TENANT_CREDENTIALS_KEY = previous;
});

test('WhatsApp credential resolver prefers encrypted tenant secret and supports legacy aliases', () => {
  const previousKey = process.env.TENANT_CREDENTIALS_KEY;
  const previousAlias = process.env.WHATSAPP_ACCESS_TOKEN_DEFAULT;
  process.env.TENANT_CREDENTIALS_KEY = Buffer.alloc(32, 8).toString('base64');
  process.env.WHATSAPP_ACCESS_TOKEN_DEFAULT = 'legacy-token';
  const tenantId = randomUUID();
  const integrationId = randomUUID();
  const envelope = encryptTenantCredential(
    'clinic-token',
    tenantId,
    'WHATSAPP_ACCESS_TOKEN',
    integrationId,
  );
  assert.equal(
    resolveIntegrationAccessToken({
      tenantId,
      integrationId,
      credentialsReference: 'WHATSAPP_ACCESS_TOKEN_DEFAULT',
      credentialCiphertext: envelope.ciphertext,
      credentialNonce: envelope.nonce,
      credentialAuthTag: envelope.authTag,
    }),
    'clinic-token',
  );
  assert.equal(
    resolveIntegrationAccessToken({
      tenantId,
      integrationId,
      credentialsReference: 'WHATSAPP_ACCESS_TOKEN_DEFAULT',
    }),
    'legacy-token',
  );
  if (previousKey === undefined) delete process.env.TENANT_CREDENTIALS_KEY;
  else process.env.TENANT_CREDENTIALS_KEY = previousKey;
  if (previousAlias === undefined)
    delete process.env.WHATSAPP_ACCESS_TOKEN_DEFAULT;
  else process.env.WHATSAPP_ACCESS_TOKEN_DEFAULT = previousAlias;
});
