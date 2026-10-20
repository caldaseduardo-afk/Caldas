import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageBubble, MessageComposer } from '../components/inbox/messages';
import { dateLabel, selectedConversation, type Message } from '../lib/inbox';
import { allowedPath } from '../lib/proxy';
test('proxy restringe rotas e métodos, sem destino arbitrário', () => {
  assert(allowedPath('GET', 'inbox/session'));
  for (const path of [
    'https://evil.test',
    '../auth/me',
    'analytics/global',
    'auth/create-user',
  ])
    assert(!allowedPath('GET', path));
  assert(!allowedPath('DELETE', 'inbox/session'));
});
test('URL aceita somente identificador de conversa, sem tenant', () => {
  assert.equal(selectedConversation('?tenantId=abc'), '');
  assert.equal(selectedConversation('?conversationId=invalid'), '');
  assert.equal(
    selectedConversation(
      '?conversationId=11111111-1111-4111-8111-111111111111&tenantId=abc',
    ),
    '11111111-1111-4111-8111-111111111111',
  );
});
test('datas são formatadas pelo timezone explícito', () => {
  assert.match(
    dateLabel('2026-10-02T02:30:00Z', 'America/Sao_Paulo'),
    /01\/10\/2026, 23:30/,
  );
  assert.match(dateLabel('2026-10-02T02:30:00Z', 'UTC'), /02\/10\/2026, 02:30/);
});
test('mensagem escapa HTML e ignora referência não segura', () => {
  const message: Message = {
    id: '1',
    senderType: 'USER',
    senderUser: { user: { name: 'Ana' } },
    messageType: 'DOCUMENT',
    content: '<script>alert(1)</script>',
    metadata: { mediaRef: 'javascript:alert(1)', fileName: 'arquivo.pdf' },
    createdAt: '2026-10-02T00:00:00Z',
  };
  const html = renderToStaticMarkup(
    <MessageBubble message={message} timezone="UTC" />,
  );
  assert(!html.includes('<script>'));
  assert(!html.includes('javascript:'));
  assert.match(html, /Ana/);
  assert.match(html, /arquivo.pdf/);
});
test('composição exige capacidade e informa ausência de envio externo', () => {
  const html = renderToStaticMarkup(
    <MessageComposer id="1" enabled={false} onSaved={() => {}} />,
  );
  assert.match(html, /disabled/);
  assert.match(html, /sem envio ao WhatsApp/);
});
