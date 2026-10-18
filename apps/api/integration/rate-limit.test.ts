import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createDatabaseClient } from '@atendente/database';
import { createApplication } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';

const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).pathname !== '/task002_test' ||
  connection !== process.env.DATABASE_URL ||
  !process.env.TEST_REDIS_URL ||
  process.env.TEST_REDIS_URL !== process.env.REDIS_URL
)
  throw new Error('Use pnpm db:test.');

test('rate limit distribuído retorna 429 e não compartilha orçamento entre tenants', async () => {
  const client = createDatabaseClient(connection);
  const app = await createApplication();
  try {
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const tenants = await Promise.all(
      ['Rate A', 'Rate B'].map((name) =>
        client.tenant.create({ data: { name, status: 'ACTIVE', timezone: 'UTC' } }),
      ),
    );
    const password = 'rate limit integração segura';
    const user = await client.user.create({
      data: {
        name: 'Clinic Admin',
        email: `${randomUUID()}@rate-limit.test`,
        passwordHash: await hashPassword(password),
        memberships: {
          create: tenants.map((tenant) => ({ tenantId: tenant.id, role: 'CLINIC_ADMIN' })),
        },
      },
    });
    const origin = process.env.AUTH_ORIGIN!;
    const login = await fetch(`${url}/auth/login`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const activate = (tenantId: string) =>
      fetch(`${url}/tenancy/active`, {
        method: 'POST',
        headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      });
    const search = () =>
      fetch(`${url}/knowledge/search/preview`, {
        method: 'POST',
        headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'planos aceitos', limit: 1 }),
      });

    assert.equal((await activate(tenants[0]!.id)).status, 200);
    for (let index = 0; index < 15; index++)
      assert.equal((await search()).status, 200);
    const limited = await search();
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);

    assert.equal((await activate(tenants[1]!.id)).status, 200);
    assert.equal((await search()).status, 200);
  } finally {
    await app.close();
    await client.$disconnect();
  }
});
