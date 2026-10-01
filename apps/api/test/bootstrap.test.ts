import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApplication } from '../src/bootstrap';

test('API inicia e expõe apenas health público', async () => {
  const app = await createApplication();
  try {
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const response = await fetch(`${url}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
    assert.equal((await fetch(`${url}/patients`)).status, 404);
  } finally {
    await app.close();
  }
});
