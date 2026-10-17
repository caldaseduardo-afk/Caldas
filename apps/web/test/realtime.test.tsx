import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  connectRealtime,
  parseEvent,
  reconnectDelay,
  type SocketLike,
  type ConnectionStatus,
} from '../lib/realtime';
import { mergeHistory, type Message } from '../lib/inbox';
const tenant = '11111111-1111-4111-8111-111111111111',
  id = '22222222-2222-4222-8222-222222222222';
const event = {
  eventId: '33333333-3333-4333-8333-333333333333',
  type: 'message.created',
  tenantId: tenant,
  conversationId: id,
  messageId: '44444444-4444-4444-8444-444444444444',
};
class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null;
  onclose: SocketLike['onclose'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onerror: SocketLike['onerror'] = null;
  closed = false;
  close() {
    this.closed = true;
  }
  receive(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}
test('payload valida tenant, IDs e tipos; campos extras não entram no estado', () => {
  assert(parseEvent(event, tenant));
  for (const e of [
    { ...event, tenantId: id },
    { ...event, eventId: 'bad' },
    { ...event, type: 'unknown' },
    { ...event, content: '<script>' },
  ])
    assert.equal(parseEvent(e, tenant), null);
});
test('backoff exponencial limitado, com jitter', () => {
  assert.equal(reconnectDelay(0, 1), 1000);
  assert.equal(reconnectDelay(1, 1), 2000);
  assert.equal(reconnectDelay(99, 1), 30000);
  assert.equal(reconnectDelay(0, 0), 750);
});
test('conexão única, dedup eventId, batching, reconnect/refetch e cleanup de listeners/timers', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sockets: FakeSocket[] = [],
    statuses: ConnectionStatus[] = [],
    changes: string[][] = [];
  let resync = 0;
  const stop = connectRealtime(
    'ws://local/realtime',
    tenant,
    {
      status: (s) => statuses.push(s),
      changed: (ids) => changes.push(ids),
      resync: () => resync++,
      denied: () => assert.fail('não esperado'),
    },
    () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  );
  const first = sockets[0]!;
  first.receive({ type: 'realtime.ready', tenantId: tenant });
  first.receive(event);
  first.receive(event);
  t.mock.timers.tick(101);
  assert.deepEqual(changes, [[id]]);
  assert.equal(sockets.length, 1);
  assert.equal(resync, 1);
  first.onclose?.({ code: 1006 } as CloseEvent);
  assert.equal(statuses.at(-1), 'reconnecting');
  t.mock.timers.tick(1001);
  assert.equal(sockets.length, 2);
  const next = sockets[1]!;
  next.receive({ type: 'realtime.ready', tenantId: tenant });
  assert.equal(resync, 2);
  next.receive(event);
  t.mock.timers.tick(101);
  assert.equal(changes.length, 1);
  stop();
  assert(next.closed);
  assert.equal(next.onmessage, null);
  assert.equal(next.onclose, null);
  t.mock.timers.tick(60000);
  assert.equal(sockets.length, 2);
});
test('tenant inesperado e sessão invalidada encerram conexão sem reconectar', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let denied = 0,
    created = 0;
  const socket = new FakeSocket();
  const stop = connectRealtime(
    'ws://local/realtime',
    tenant,
    {
      status: () => {},
      changed: () => assert.fail(),
      resync: () => assert.fail(),
      denied: () => denied++,
    },
    () => {
      created++;
      return socket;
    },
  );
  socket.receive({ type: 'realtime.ready', tenantId: id });
  assert(socket.closed);
  assert.equal(denied, 1);
  t.mock.timers.tick(60000);
  assert.equal(created, 1);
  stop();
});
function message(id: string, createdAt: string): Message {
  return {
    id,
    createdAt,
    senderType: 'USER',
    senderUser: null,
    messageType: 'TEXT',
    content: id,
    metadata: {},
  };
}
test('REST + WebSocket não duplicam mensagens e preservam anteriores; lacuna ressincroniza', () => {
  const one = message('a', '2026-10-03T10:00:00Z'),
    two = message('b', '2026-10-03T11:00:00Z'),
    three = message('c', '2026-10-03T12:00:00Z');
  const merged = mergeHistory(
    { items: [one, two], before: 'older' },
    { items: [two, three], before: 'recent' },
  );
  assert.deepEqual(
    merged.items.map((m) => m.id),
    ['a', 'b', 'c'],
  );
  assert.equal(merged.before, 'older');
  assert.deepEqual(
    mergeHistory(merged, { items: [two, three], before: 'recent' }),
    merged,
  );
  assert.deepEqual(
    mergeHistory(
      { items: [one], before: null },
      { items: [three], before: 'gap' },
    ),
    { items: [three], before: 'gap' },
  );
});
