import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { startHoldExpiry, sweepInterval } from '../src/hold-expiry';
test('expiração: configura intervalo e impede jobs sobrepostos; stop aguarda execução', async () => {
  assert.equal(sweepInterval(undefined), 30000);
  for (const value of ['0', '-1', 'NaN', '1.5', '3600001'])
    assert.throws(() => sweepInterval(value));
  let calls = 0;
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const stop = startHoldExpiry(
    async () => {
      calls++;
      await gate;
    },
    5,
    () => assert.fail('Erro inesperado'),
  );
  await delay(25);
  assert.equal(calls, 1);
  let stopped = false;
  const done = stop().then(() => {
    stopped = true;
  });
  await delay(5);
  assert.equal(stopped, false);
  finish();
  await done;
  await delay(10);
  assert.equal(calls, 1);
});
test('falha do sweep é recuperável no próximo ciclo', async () => {
  let calls = 0,
    errors = 0;
  let resolve!: () => void;
  const recovered = new Promise<void>((done) => {
    resolve = done;
  });
  const stop = startHoldExpiry(
    async () => {
      if (++calls === 1) throw new Error('Falha de teste');
      resolve();
    },
    5,
    () => {
      errors++;
    },
  );
  try {
    await recovered;
    assert.equal(errors, 1);
  } finally {
    await stop();
  }
});
