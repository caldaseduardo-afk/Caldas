import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { WhatsAppProvider, whatsappAccessToken } from '@atendente/database';
import { MessagingProviderError } from '@atendente/domain';
import { normalizePhone } from '../src/contacts/phone';
const provider = new WhatsAppProvider('v23.0');
function payload(message: unknown) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '12345678',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: '87654321' },
              contacts: [
                { wa_id: '5561999999999', profile: { name: 'Contato' } },
              ],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}
const base = { from: '5561999999999', id: 'wamid.unit' };
test('WhatsApp: challenge e HMAC exigem token, segredo e bytes corretos', () => {
  assert.equal(
    provider.verifyWebhook('subscribe', 'token', '1234', 'token'),
    '1234',
  );
  for (const args of [
    ['subscribe', 'bad', '1234', 'token'],
    ['wrong', 'token', '1234', 'token'],
    ['subscribe', '', '1234', ''],
  ])
    assert.throws(() =>
      provider.verifyWebhook(...(args as [string, string, string, string])),
    );
  const raw = Buffer.from('{"entry":[]}'),
    signature =
      'sha256=' + createHmac('sha256', 'secret').update(raw).digest('hex');
  assert.equal(provider.verifySignature(raw, signature, 'secret'), true);
  assert.equal(
    provider.verifySignature(Buffer.from('{}'), signature, 'secret'),
    false,
  );
  assert.equal(provider.verifySignature(raw, signature, ''), false);
  assert.equal(provider.verifySignature(raw, undefined, 'secret'), false);
});
for (const [type, data, expected] of [
  ['text', { body: 'Olá' }, 'TEXT'],
  [
    'image',
    { id: '123456', mime_type: 'image/jpeg', caption: 'Legenda' },
    'IMAGE',
  ],
  ['audio', { id: '123457', mime_type: 'audio/ogg' }, 'AUDIO'],
  [
    'document',
    { id: '123458', mime_type: 'application/pdf', filename: 'arquivo.pdf' },
    'DOCUMENT',
  ],
  [
    'location',
    { latitude: -15.7, longitude: -47.9, name: 'Brasília' },
    'LOCATION',
  ],
  [
    'contacts',
    [
      {
        name: { formatted_name: 'Maria' },
        phones: [{ phone: '+5561999999999' }],
      },
    ],
    'CONTACT',
  ],
  [
    'interactive',
    { type: 'button_reply', button_reply: { id: 'yes', title: 'Sim' } },
    'INTERACTIVE',
  ],
] as const)
  test(`WhatsApp: mapeia ${type} sem payload cru ou autoria externa`, () => {
    const event = provider.parseInboundWebhook(
      payload({
        ...base,
        type,
        [type]: data,
        sender_type: 'AI',
        tenant_id: 'malicious',
      }),
    )[0]!;
    assert.equal(event.messageType, expected);
    assert.equal(event.from, base.from);
    assert.equal(event.providerMessageId, base.id);
    assert.equal('tenant_id' in event, false);
    assert.equal('sender_type' in event, false);
    assert.ok(JSON.stringify(event).length < 1000);
  });
test('WhatsApp: payload inválido, lote excessivo e mídia binária são recusados', () => {
  for (const value of [
    null,
    [],
    {},
    { object: 'x', entry: [] },
    payload({ ...base, type: 'text', text: { body: '' } }),
    payload({
      ...base,
      type: 'image',
      image: { id: 'data:base64,' + 'x'.repeat(5000) },
    }),
  ])
    assert.throws(() => provider.parseInboundWebhook(value));
  assert.deepEqual(
    provider.parseInboundWebhook(payload({ ...base, type: 'unsupported' })),
    [],
  );
});
test('WhatsApp: normalização usa o contrato TASK-007', () => {
  for (const value of [
    '(61) 99999-9999',
    '61 99999-9999',
    '+55 61 99999-9999',
    '+' + base.from,
  ])
    assert.equal(normalizePhone(value), '+5561999999999');
});
test('WhatsApp: envio usa URL oficial, bearer e correlação; interfaces de mídia e interatividade', async () => {
  const requests: Record<string, unknown>[] = [];
  const transport: typeof fetch = async (url, init) => {
    assert.equal(url, 'https://graph.facebook.com/v23.0/87654321/messages');
    assert.deepEqual(init?.headers, {
      Authorization: 'Bearer token-test-only',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    assert.equal(body.biz_opaque_callback_data, 'correlation');
    assert.equal(body.to, base.from);
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.sent' }] }), {
      status: 200,
    });
  };
  const p = new WhatsAppProvider('v23.0', transport),
    context = {
      phoneNumberId: '87654321',
      accessToken: 'token-test-only',
      to: '+5561999999999',
      messageId: 'correlation',
    };
  assert.equal(await p.sendTextMessage(context, 'Olá'), 'wamid.sent');
  await p.sendMediaMessage(context, { type: 'image', id: '123456' });
  await p.sendInteractiveMessage(context, {
    text: 'Escolha',
    buttons: [{ id: 'yes', title: 'Sim' }],
  });
  assert.deepEqual(
    requests.map((r) => r.type),
    ['text', 'image', 'interactive'],
  );
});
test('WhatsApp: erros são sanitizados, transitórios limitados, resultado incerto distinto', async () => {
  const context = {
    phoneNumberId: '87654321',
    accessToken: 'secret-access',
    to: '+5561999999999',
    messageId: 'id',
  };
  for (const [http, code, retryable, uncertain] of [
    [400, 131047, false, false],
    [401, 190, false, false],
    [429, 130429, true, false],
    [503, 2, true, false],
    [503, 0, true, true],
  ] as const) {
    const p = new WhatsAppProvider(
      'v23.0',
      async () =>
        new Response(
          JSON.stringify({ error: { code, message: 'secret-access PRIVATE' } }),
          { status: http },
        ),
    );
    await assert.rejects(
      p.sendTextMessage(context, 'Olá'),
      (e: unknown) =>
        e instanceof MessagingProviderError &&
        e.retryable === retryable &&
        e.uncertain === uncertain &&
        !JSON.stringify(e).includes('secret-access') &&
        !e.message.includes('PRIVATE'),
    );
  }
  const p = new WhatsAppProvider('v23.0', async () => {
    throw new Error('secret-access timeout');
  });
  await assert.rejects(
    p.sendTextMessage(context, 'Olá'),
    (e: unknown) =>
      e instanceof MessagingProviderError &&
      e.uncertain &&
      e.code === 'SEND_UNCERTAIN',
  );
});
test('WhatsApp: credencial só resolve referência de namespace próprio', () => {
  assert.equal(
    whatsappAccessToken('WHATSAPP_ACCESS_TOKEN_TEST', {
      WHATSAPP_ACCESS_TOKEN_TEST: 'test-only',
    }),
    'test-only',
  );
  for (const reference of [
    'DATABASE_URL',
    'AUTH_SECRET',
    'WHATSAPP_ACCESS_TOKEN_',
    'WHATSAPP_ACCESS_TOKEN_MISSING',
  ])
    assert.throws(() => whatsappAccessToken(reference, {}));
});

test('WhatsApp: perfil sem nome usa contato provisório neutro', () => {
  const body = payload({ ...base, type: 'text', text: { body: 'Olá' } });
  body.entry[0]!.changes[0]!.value.contacts[0]!.profile.name = '';
  assert.equal(
    provider.parseInboundWebhook(body)[0]!.displayName,
    'Contato WhatsApp',
  );
});
