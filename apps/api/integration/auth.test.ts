import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createDatabaseClient } from '@atendente/database';
import { createApplication } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { AuthService, tokenHash } from '../src/auth/auth.service';

const connectionString = process.env.TEST_DATABASE_URL;
if (
  !connectionString ||
  new URL(connectionString).pathname !== '/task002_test' ||
  process.env.DATABASE_URL !== connectionString
) {
  throw new Error(
    'Use pnpm db:test para executar a integração em banco descartável.',
  );
}

test('autenticação HTTP com PostgreSQL real', async (t) => {
  const client = createDatabaseClient(connectionString);
  let app = await createApplication();
  const password = 'senha longa exclusiva de teste';
  const email = `${randomUUID()}@example.test`;
  const user = await client.user.create({
    data: {
      email,
      name: 'Pessoa de teste',
      passwordHash: await hashPassword(password),
    },
  });
  await app.listen(0, '127.0.0.1');
  let url = await app.getUrl();
  const origin = process.env.AUTH_ORIGIN!;
  const post = (
    path: string,
    body: unknown,
    cookie = '',
    requestOrigin = origin,
  ) =>
    fetch(`${url}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: requestOrigin,
        Cookie: cookie,
      },
      body: JSON.stringify(body),
    });
  const me = (cookie = '') =>
    fetch(`${url}/auth/me`, { headers: { Cookie: cookie } });
  const login = async () => {
    const response = await post('/auth/login', { email, password });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!.split(';')[0]!;
  };
  try {
    await t.test('guard, validação e CSRF', async () => {
      assert.equal((await me()).status, 401);
      assert.equal((await me('atendente_session=forjada')).status, 401);
      assert.equal(
        (await fetch(`${url}/auth/register`, { method: 'POST' })).status,
        404,
      );
      assert.equal(
        (
          await post(
            '/auth/login',
            { email, password },
            '',
            'https://evil.example',
          )
        ).status,
        403,
      );
      assert.equal(
        (await post('/auth/login', { email, password }, '', '')).status,
        403,
      );
      assert.equal(
        (await post('/auth/login', { email, password, role: 'SUPER_ADMIN' }))
          .status,
        400,
      );
      assert.equal(
        (
          await fetch(`${url}/auth/login`, {
            method: 'POST',
            headers: { Origin: origin, 'Content-Type': 'text/plain' },
            body: '{}',
          })
        ).status,
        415,
      );
      assert.equal(
        (await post('/auth/login', { email, password: 'a'.repeat(9000) }))
          .status,
        413,
      );
    });
    await t.test(
      'login, cookie seguro e persistência após reinício',
      async () => {
        const response = await post('/auth/login', {
          email: email.toUpperCase(),
          password,
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          id: user.id,
          email,
          name: user.name,
        });
        const header = response.headers.get('set-cookie')!;
        assert.match(header, /HttpOnly/);
        assert.match(header, /SameSite=Strict/);
        assert.match(header, /Max-Age=28800/);
        assert.match(header, /Path=\//);
        const cookie = header.split(';')[0]!;
        const token = cookie.split('=')[1]!;
        const stored = await client.authSession.findUniqueOrThrow({
          where: { tokenHash: tokenHash(token) },
        });
        assert.notEqual(stored.tokenHash, token);
        await app.close();
        app = await createApplication();
        await app.listen(0, '127.0.0.1');
        url = await app.getUrl();
        const authenticated = await me(cookie);
        assert.equal(authenticated.status, 200);
        assert.equal(authenticated.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await authenticated.json(), {
          id: user.id,
          email,
          name: user.name,
        });
      },
    );
    await t.test('rotação, logout revogável, replay e auditoria', async () => {
      await client.authThrottle.deleteMany();
      const first = await login();
      const rotated = await post('/auth/login', { email, password }, first);
      assert.equal(rotated.status, 200);
      const second = rotated.headers.get('set-cookie')!.split(';')[0]!;
      assert.notEqual(second, first);
      assert.equal((await me(first)).status, 401);
      assert.equal(
        (await post('/auth/logout', {}, second, 'https://evil.example')).status,
        403,
      );
      assert.equal((await me(second)).status, 200);
      const logout = await post('/auth/logout', {}, second);
      assert.equal(logout.status, 204);
      assert.match(logout.headers.get('set-cookie')!, /Max-Age=0/);
      assert.equal((await me(second)).status, 401);
      const events = await client.authEvent.findMany({
        where: { userId: user.id },
      });
      assert.ok(events.some((event) => event.type === 'LOGIN_SUCCEEDED'));
      assert.ok(events.some((event) => event.type === 'LOGOUT'));
      assert.equal(JSON.stringify(events).includes(password), false);
      assert.equal(
        JSON.stringify(events).includes(second.split('=')[1]!),
        false,
      );
    });
    await t.test(
      'expiração e revogação de identidade/MFA na consulta de sessão',
      async () => {
        await client.authThrottle.deleteMany();
        const expired = await login();
        await client.authSession.updateMany({
          where: { userId: user.id },
          data: { expiresAt: new Date(0) },
        });
        assert.equal((await me(expired)).status, 401);
        const cookie = await login();
        for (const patch of [
          { status: 'DISABLED' as const },
          { mfaEnabled: true },
          { mfaRequired: true },
        ]) {
          await client.user.update({ where: { id: user.id }, data: patch });
          assert.equal((await me(cookie)).status, 401);
          await client.authThrottle.deleteMany();
          const response = await post('/auth/login', { email, password });
          assert.equal(response.status, 401);
          assert.equal(response.headers.get('set-cookie'), null);
          await client.user.update({
            where: { id: user.id },
            data: { status: 'ACTIVE', mfaEnabled: false, mfaRequired: false },
          });
        }
      },
    );
    await t.test('erro genérico e rate limit HTTP persistente', async () => {
      await client.authThrottle.deleteMany();
      const invalid = await post('/auth/login', {
        email,
        password: 'senha errada para teste',
      });
      const unknown = await post('/auth/login', {
        email: 'naoexiste@example.test',
        password,
      });
      assert.equal(invalid.status, 401);
      assert.equal(unknown.status, 401);
      assert.deepEqual(await invalid.json(), await unknown.json());
      for (let attempt = 0; attempt < 4; attempt++)
        assert.equal(
          (
            await post('/auth/login', {
              email,
              password: 'senha errada para teste',
            })
          ).status,
          401,
        );
      assert.equal(
        (await post('/auth/login', { email, password })).status,
        429,
      );
      await app.close();
      app = await createApplication();
      await app.listen(0, '127.0.0.1');
      url = await app.getUrl();
      assert.equal(
        (await post('/auth/login', { email, password })).status,
        429,
      );
      await client.authThrottle.updateMany({
        data: { expiresAt: new Date(0) },
      });
      assert.equal(
        (await post('/auth/login', { email, password })).status,
        200,
      );
    });
    await t.test('limite atômico por email e por IP', async () => {
      await client.authThrottle.deleteMany();
      const service = app.get(AuthService);
      const parallel = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          service.throttle(`ip-${i}`, 'concurrent@example.test'),
        ),
      );
      assert.equal(
        parallel.filter((result) => result.status === 'fulfilled').length,
        5,
      );
      await client.authThrottle.deleteMany();
      for (let i = 0; i < 20; i++)
        await service.throttle('same-ip', `account-${i}@example.test`);
      await assert.rejects(service.throttle('same-ip', 'other@example.test'));
    });
    await t.test(
      'cookie de produção recebe Secure e prefixo __Host-',
      async () => {
        await app.close();
        process.env.NODE_ENV = 'production';
        process.env.AUTH_ORIGIN = 'https://app.example.test';
        app = await createApplication();
        await app.listen(0, '127.0.0.1');
        url = await app.getUrl();
        await client.authThrottle.deleteMany();
        const response = await post(
          '/auth/login',
          { email, password },
          '',
          'https://app.example.test',
        );
        assert.equal(response.status, 200);
        const cookie = response.headers.get('set-cookie')!;
        assert.match(cookie, /^__Host-atendente_session=/);
        assert.match(cookie, /; Secure/);
        assert.doesNotMatch(cookie, /Domain=/);
      },
    );
  } finally {
    process.env.NODE_ENV = 'development';
    process.env.AUTH_ORIGIN = origin;
    await app.close();
    await client.$disconnect();
  }
});
