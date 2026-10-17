import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inboxQuery, historyQuery } from '../src/inbox/inbox.dto';
test('inbox valida filtros, busca e paginação sem aceitar tenant', () => {
  assert.deepEqual(inboxQuery({}), {
    page: 1,
    limit: 20,
    q: '',
    status: undefined,
  });
  assert.equal(inboxQuery({ q: ' Maria ', status: 'AI_ACTIVE' }).q, 'Maria');
  for (const input of [
    { tenantId: 'x' },
    { q: ['x'] },
    { q: '' },
    { limit: '101' },
    { status: 'UNREAD' },
    { page: '-1' },
    { page: '10000' },
  ])
    assert.throws(() => inboxQuery(input));
});
test('histórico valida cursor e limite com defaults recentes', () => {
  assert.deepEqual(historyQuery({}), { limit: 30, before: undefined });
  for (const input of [{ before: 'invalid' }, { page: '2' }, { limit: '0' }])
    assert.throws(() => historyQuery(input));
});
