import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { hashPassword, verifyPassword } from '../src/auth/password';
import { AuthConfig } from '../src/auth/auth.config';
import { loginInput } from '../src/auth/auth.input';

test('hash seguro usa salts diferentes e valida somente a senha correta', async () => {
  const password = 'uma senha longa de teste';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(first.includes(password), false);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('outra senha longa', first), false);
  assert.equal(await verifyPassword(password, 'hash corrompido'), false);
  await assert.rejects(hashPassword('curta'));
  await assert.rejects(hashPassword('a'.repeat(129)));
});

test('configuração segura exige segredo e origem HTTPS em produção', () => {
  const env = {
    AUTH_SECRET: randomBytes(32).toString('hex'),
    AUTH_ORIGIN: 'https://app.example.com',
    NODE_ENV: 'production',
  };
  const config = new AuthConfig(env);
  assert.equal(config.secure, true);
  assert.ok(config.cookieName.startsWith('__Host-'));
  for (const patch of [
    { AUTH_SECRET: '' },
    { AUTH_ORIGIN: 'http://app.example.com' },
    { AUTH_ORIGIN: 'https://app.example.com/path' },
    { AUTH_ORIGIN: 'inválida' },
  ]) {
    assert.throws(() => new AuthConfig({ ...env, ...patch }));
  }
});

test('entrada de login normaliza email e rejeita dados adicionais', () => {
  assert.deepEqual(
    loginInput({ email: ' TEST@Example.com ', password: 'senha longa teste' }),
    { email: 'test@example.com', password: 'senha longa teste' },
  );
  for (const input of [
    null,
    [],
    {},
    { email: 'a@b.com', password: 'x' },
    { email: 'a@b.com', password: 'senha longa teste', tenantId: 'inventado' },
  ]) {
    assert.throws(() => loginInput(input));
  }
});
