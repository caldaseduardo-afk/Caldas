import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap';
import { AuthService } from '../src/auth/auth.service';
import { AuthConfig } from '../src/auth/auth.config';
import { DatabaseService } from '../src/auth/database.service';

@Controller('private-probe')
class PrivateProbe {
  @Get() get() {
    return { protected: true };
  }
}

test('guard global protege rotas sem opt-in; health permanece público', async () => {
  const config = new AuthConfig({
    AUTH_SECRET: randomBytes(32).toString('hex'),
    AUTH_ORIGIN: 'http://localhost:3000',
    NODE_ENV: 'test',
  });
  const module = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [PrivateProbe],
  })
    .overrideProvider(DatabaseService)
    .useValue({ client: {} })
    .overrideProvider(AuthService)
    .useValue({
      authenticate: async () => ({
        identity: {
          id: 'test-user',
          name: 'Teste',
          email: 'test@example.test',
        },
        sessionId: 'test-session',
        activeTenantId: null,
      }),
    })
    .overrideProvider(AuthConfig)
    .useValue(config)
    .compile();
  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });
  configureApplication(app, config);
  try {
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    assert.deepEqual(await (await fetch(`${url}/health`)).json(), {
      status: 'ok',
    });
    for (const route of ['/private-probe', '/auth/me']) {
      assert.equal((await fetch(`${url}${route}`)).status, 401);
    }
    assert.equal((await fetch(`${url}/patients`)).status, 404);
    const headers = { Cookie: `atendente_session=${'a'.repeat(43)}` };
    assert.equal((await fetch(`${url}/auth/me`, { headers })).status, 200);
    assert.equal(
      (await fetch(`${url}/private-probe`, { headers })).status,
      403,
    );
    assert.equal(
      (await fetch(`${url}/tenancy/units`, { headers })).status,
      403,
    );
  } finally {
    await app.close();
  }
});
