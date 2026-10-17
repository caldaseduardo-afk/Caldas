import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  conversationStatuses,
  assertConversationTransition,
} from '../src/conversations/conversation.state';
import {
  createConversationDto,
  contextDto,
  conversationStatusDto,
  messageDto,
  receiptDto,
  conversationQuery,
  messageQuery,
} from '../src/conversations/conversation.dto';
test('conversas: matriz centralizada de estados sem reabertura arbitrária', () => {
  const allowed = new Set([
    'AI_ACTIVE:WAITING_PATIENT',
    'AI_ACTIVE:NEEDS_HUMAN',
    'AI_ACTIVE:RESOLVED',
    'WAITING_PATIENT:AI_ACTIVE',
    'WAITING_PATIENT:NEEDS_HUMAN',
    'WAITING_PATIENT:RESOLVED',
    'NEEDS_HUMAN:HUMAN_ACTIVE',
    'HUMAN_ACTIVE:AI_ACTIVE',
    'HUMAN_ACTIVE:RESOLVED',
    'RESOLVED:CLOSED',
  ]);
  for (const from of conversationStatuses)
    for (const to of conversationStatuses) {
      const fn = () => assertConversationTransition(from, to);
      if (allowed.has(`${from}:${to}`)) assert.doesNotThrow(fn);
      else assert.throws(fn);
    }
});
test('DTOs de conversa separam contexto/intenção/estado e restringem atribuição interna', () => {
  const contactId = randomUUID();
  assert.deepEqual(createConversationDto({ contactId }), {
    contactId,
    channel: 'WHATSAPP',
  });
  for (const extra of [
    { tenantId: randomUUID() },
    { status: 'HUMAN_ACTIVE' },
    { assignedUserId: randomUUID() },
    { channel: 'WEB' },
  ])
    assert.throws(() => createConversationDto({ contactId, ...extra }));
  assert.deepEqual(contextDto({ activePatientId: null, intent: 'PAYMENT' }), {
    activePatientId: null,
    intent: 'PAYMENT',
  });
  assert.throws(() => contextDto({ status: 'AI_ACTIVE' }));
  assert.throws(() => contextDto({}));
  assert.equal(
    conversationStatusDto({ status: 'NEEDS_HUMAN' }).handoffReason,
    'OTHER',
  );
  assert.throws(() =>
    conversationStatusDto({ status: 'AI_ACTIVE', handoffReason: 'OTHER' }),
  );
  assert.throws(() =>
    conversationStatusDto({
      status: 'HUMAN_ACTIVE',
      assignedUserId: randomUUID(),
    }),
  );
  assert.throws(() => conversationStatusDto({ status: 'HUMAN_ACTIVE' }, true));
  assert.equal(
    conversationStatusDto(
      { status: 'HUMAN_ACTIVE', assignedUserId: randomUUID() },
      true,
    ).status,
    'HUMAN_ACTIVE',
  );
});
test('metadata por tipo, referência sem blob e autor/datas determinados no servidor', () => {
  assert.equal(
    messageDto({ messageType: 'TEXT', content: 'Olá\nTudo bem?' }).content,
    'Olá\nTudo bem?',
  );
  for (const extra of [
    { senderType: 'AI' },
    { senderUserId: randomUUID() },
    { tenantId: randomUUID() },
    { providerMessageId: 'x' },
    { createdAt: new Date().toISOString() },
    { deliveredAt: new Date().toISOString() },
    { metadata: { binary: 'x' } },
  ])
    assert.throws(() =>
      messageDto({ messageType: 'TEXT', content: 'Olá', ...extra }),
    );
  assert.throws(() => messageDto({ messageType: 'TEXT', content: ' ' }));
  assert.throws(() =>
    messageDto({ messageType: 'TEXT', content: 'x'.repeat(4001) }),
  );
  assert.throws(() => messageDto({ messageType: 'TEXT', content: 'x' }, true));
  for (const messageType of ['IMAGE', 'AUDIO', 'DOCUMENT']) {
    assert.deepEqual(
      messageDto({
        messageType,
        metadata: {
          mediaRef: 'asset:123',
          mimeType: 'image/png',
          sizeBytes: 10,
        },
      }).metadata,
      { mediaRef: 'asset:123', mimeType: 'image/png', sizeBytes: 10 },
    );
    assert.throws(() =>
      messageDto({
        messageType,
        metadata: { mediaRef: 'data:image/png;base64,AAAA' },
      }),
    );
    assert.throws(() =>
      messageDto({
        messageType,
        metadata: { mediaRef: 'asset:1', binary: [1, 2] },
      }),
    );
  }
  assert.equal(
    messageDto({
      messageType: 'LOCATION',
      metadata: { latitude: -15.8, longitude: -47.9 },
    }).messageType,
    'LOCATION',
  );
  assert.throws(() =>
    messageDto({
      messageType: 'LOCATION',
      metadata: { latitude: 91, longitude: 0 },
    }),
  );
  assert.equal(
    messageDto({
      messageType: 'CONTACT',
      metadata: { displayName: 'Contato', phone: '+5561999999999' },
    }).messageType,
    'CONTACT',
  );
  assert.equal(
    messageDto({
      messageType: 'INTERACTIVE',
      metadata: { interactionId: 'abc', selectionId: 'sim' },
    }).messageType,
    'INTERACTIVE',
  );
});
test('paginação limitada e receipts com datas absolutas válidas', () => {
  assert.deepEqual(messageQuery({}), { page: 1, limit: 20 });
  assert.deepEqual(messageQuery({ page: '2', limit: '5' }), {
    page: 2,
    limit: 5,
  });
  for (const input of [
    { page: '0' },
    { limit: '101' },
    { page: '10000', limit: '20' },
    { tenantId: randomUUID() },
    { page: '1.1' },
  ])
    assert.throws(() => messageQuery(input));
  assert.equal(
    conversationQuery({
      intent: 'PAYMENT',
      status: 'AI_ACTIVE',
      contactId: randomUUID(),
    }).filter.intent,
    'PAYMENT',
  );
  assert.throws(() => conversationQuery({ activePatientId: 'bad' }));
  assert.equal(
    receiptDto({
      kind: 'READ',
      at: '2026-10-06T12:34:56.789Z',
    }).at.toISOString(),
    '2026-10-06T12:34:56.789Z',
  );
  for (const at of [
    '2026-02-30T12:00:00Z',
    '2026-10-06T25:00:00Z',
    '2026-10-06T12:00:00',
    '2026-10-06T12:00:60Z',
  ])
    assert.throws(() => receiptDto({ kind: 'READ', at }));
});
