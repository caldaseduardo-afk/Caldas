import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageBubble, MessageComposer } from '../components/inbox/messages';
test('WhatsApp: estados de entrega e resultado incerto são distintos do estado da conversa', () => {
  for (const [deliveryStatus, label] of [
    ['PENDING', 'Aguardando envio'],
    ['SENT', 'Enviada'],
    ['DELIVERED', 'Entregue'],
    ['READ', 'Lida'],
    ['FAILED', 'Falha no envio'],
  ]) {
    const html = renderToStaticMarkup(
      <MessageBubble
        timezone="UTC"
        message={{
          id: '1',
          senderType: 'USER',
          senderUser: null,
          messageType: 'TEXT',
          content: 'Teste',
          metadata: {},
          createdAt: '2026-10-05T12:00:00Z',
          deliveryStatus,
        }}
      />,
    );
    assert.ok(html.includes(label!));
  }
  const html = renderToStaticMarkup(
    <MessageBubble
      timezone="UTC"
      message={{
        id: '1',
        senderType: 'USER',
        senderUser: null,
        messageType: 'TEXT',
        content: 'Teste',
        metadata: {},
        createdAt: '2026-10-05T12:00:00Z',
        deliveryStatus: 'FAILED',
        errorCode: 'SEND_UNCERTAIN',
      }}
    />,
  );
  assert.ok(html.includes('Envio não confirmado'));
  assert.ok(
    renderToStaticMarkup(
      <MessageComposer id="1" enabled integrated onSaved={() => {}} />,
    ).includes('Enviar mensagem'),
  );
});
