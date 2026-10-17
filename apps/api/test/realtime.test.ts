import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RealtimeEvents } from '../src/realtime/realtime.events';
test('barramento sanitiza payload, isola falha de consumidor e remove listeners', () => {
  const bus = new RealtimeEvents();
  let received = 0,
    invalidated = 0;
  const stopFailure = bus.subscribe(() => {
    throw new Error('consumer');
  });
  const stop = bus.subscribe((event) => {
    received++;
    assert.deepEqual(Object.keys(event).sort(), [
      'conversationId',
      'eventId',
      'tenantId',
      'type',
    ]);
  });
  const stopSession = bus.onSessionInvalidated(() => invalidated++);
  bus.publish({
    type: 'conversation.updated',
    tenantId: 't',
    conversationId: 'c',
  });
  assert.equal(received, 1);
  stop();
  stopFailure();
  stopSession();
  bus.invalidateSession('s');
  bus.publish({
    type: 'conversation.updated',
    tenantId: 't',
    conversationId: 'c',
  });
  assert.equal(received, 1);
  assert.equal(invalidated, 0);
});
