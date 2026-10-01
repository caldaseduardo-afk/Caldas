import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabaseClient } from '../src';
import { assertDevelopmentSeed } from '../src/development-seed';

test('seed recusa ambiente diferente de development', () => {
  for (const environment of [undefined, 'production', 'test', '']) {
    assert.throws(() => assertDevelopmentSeed(environment));
  }
  assert.doesNotThrow(() => assertDevelopmentSeed('development'));
});

test('conexão exige URL PostgreSQL explícita', () => {
  for (const url of ['', '  ', 'https://localhost', 'inválida']) {
    assert.throws(() => createDatabaseClient(url));
  }
});
