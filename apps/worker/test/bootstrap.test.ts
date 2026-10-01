import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApplication } from '../src/bootstrap';
import { AppModule } from '../src/app.module';

test('worker inicializa e encerra sem serviços externos', async () => {
  const app = await createApplication();
  try {
    assert.ok(app.get(AppModule));
  } finally {
    await app.close();
  }
});
