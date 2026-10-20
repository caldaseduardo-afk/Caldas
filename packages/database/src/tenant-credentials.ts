import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { whatsappAccessToken } from './whatsapp-provider';

export interface EncryptedCredential {
  ciphertext: string;
  nonce: string;
  authTag: string;
}

function encryptionKey() {
  const encoded = process.env.TENANT_CREDENTIALS_KEY ?? '';
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded)
    throw new Error(
      'TENANT_CREDENTIALS_KEY deve ser uma chave base64 de 32 bytes.',
    );
  return key;
}

function associatedData(tenantId: string, purpose: string, resourceId = '') {
  return Buffer.from(`${tenantId}:${purpose}:${resourceId}`, 'utf8');
}

export function encryptTenantCredential(
  plaintext: string,
  tenantId: string,
  purpose: string,
  resourceId = '',
): EncryptedCredential {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), nonce);
  cipher.setAAD(associatedData(tenantId, purpose, resourceId));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString('base64'),
    nonce: nonce.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptTenantCredential(
  value: EncryptedCredential,
  tenantId: string,
  purpose: string,
  resourceId = '',
) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(value.nonce, 'base64'),
  );
  decipher.setAAD(associatedData(tenantId, purpose, resourceId));
  decipher.setAuthTag(Buffer.from(value.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function resolveIntegrationAccessToken(input: {
  tenantId: string;
  integrationId: string;
  credentialsReference: string;
  credentialCiphertext?: string | null;
  credentialNonce?: string | null;
  credentialAuthTag?: string | null;
}) {
  if (
    input.credentialCiphertext &&
    input.credentialNonce &&
    input.credentialAuthTag
  )
    return decryptTenantCredential(
      {
        ciphertext: input.credentialCiphertext,
        nonce: input.credentialNonce,
        authTag: input.credentialAuthTag,
      },
      input.tenantId,
      'WHATSAPP_ACCESS_TOKEN',
      input.integrationId,
    );
  // Backward-compatible operator-managed secret alias.
  return whatsappAccessToken(input.credentialsReference);
}
