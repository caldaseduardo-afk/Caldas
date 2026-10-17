import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encodeSecret, decodeSecret, totp, verifyTotp, encryptSecret, decryptSecret } from '../src/platform-admin/platform-totp';

test('TOTP reproduz vetores SHA1 da RFC 6238', () => {
  const secret = encodeSecret(Buffer.from('12345678901234567890'));
  assert.equal(decodeSecret(secret).toString(), '12345678901234567890');
  for (const [seconds, expected] of [[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']] as const)
    assert.equal(totp(secret, Math.floor(seconds / 30), 8), expected);
});

test('TOTP rejeita replay, formato inválido e código fora da janela', () => {
  const secret = encodeSecret(randomBytes(20));
  const step = 10000;
  const now = new Date(step * 30000);
  assert.equal(verifyTotp(secret, totp(secret, step), now, -1n), step);
  assert.equal(verifyTotp(secret, totp(secret, step), now, BigInt(step)), null);
  assert.equal(verifyTotp(secret, '123', now, -1n), null);
  for (const offset of [-1, 1]) assert.equal(verifyTotp(secret, totp(secret, step + offset), now, -1n), step + offset);
});

test('MFA secret cifrado autentica conteúdo e identidade; não aceita chave ausente', () => {
  const original = process.env.PLATFORM_MFA_KEY;
  try {
    process.env.PLATFORM_MFA_KEY = randomBytes(32).toString('base64');
    const secret = encodeSecret(randomBytes(20));
    const encrypted = encryptSecret(secret, 'user-a');
    assert.equal(decryptSecret(encrypted, 'user-a'), secret);
    assert.throws(() => decryptSecret(encrypted, 'user-b'));
    const parts = encrypted.split('.');
    const ciphertext = Buffer.from(parts[2]!, 'base64'); ciphertext[0] = ciphertext[0]! ^ 1;
    parts[2] = ciphertext.toString('base64');
    assert.throws(() => decryptSecret(parts.join('.'), 'user-a'));
    delete process.env.PLATFORM_MFA_KEY;
    assert.throws(() => encryptSecret(secret, 'user-a'), /PLATFORM_MFA_KEY_REQUIRED/);
  } finally {
    if (original === undefined) delete process.env.PLATFORM_MFA_KEY;
    else process.env.PLATFORM_MFA_KEY = original;
  }
});
