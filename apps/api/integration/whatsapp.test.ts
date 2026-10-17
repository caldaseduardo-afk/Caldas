import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import {
  createDatabaseClient,
  WhatsAppProvider,
  deliverMessage,
  createMessagingQueue,
  createMessagingWorker,
  dispatchMessages,
  databaseNow,
} from '@atendente/database';
import { createApplication } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { RealtimeEvents } from '../src/realtime/realtime.events';
const connection = process.env.TEST_DATABASE_URL,
  redis = process.env.TEST_REDIS_URL;
if (
  !connection ||
  new URL(connection).pathname !== '/task002_test' ||
  connection !== process.env.DATABASE_URL ||
  !redis ||
  redis !== process.env.REDIS_URL
)
  throw new Error('Use pnpm db:test.');
async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 8000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Evento WhatsApp ausente.');
    await delay(20);
  }
}
test('TASK-020: WhatsApp oficial, webhook, isolamento, envio, concorrência e realtime', async (t) => {
  const original = {
    secret: process.env.WHATSAPP_APP_SECRET,
    verify: process.env.WHATSAPP_VERIFY_TOKEN,
    version: process.env.WHATSAPP_GRAPH_VERSION,
    token: process.env.WHATSAPP_ACCESS_TOKEN_TEST,
  };
  process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
  process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
  process.env.WHATSAPP_GRAPH_VERSION = 'v23.0';
  process.env.WHATSAPP_ACCESS_TOKEN_TEST = 'test-access-token';
  const client = createDatabaseClient(connection),
    app = await createApplication();
  const sockets: WebSocket[] = [],
    committedChecks: Promise<void>[] = [];
  let queue: ReturnType<typeof createMessagingQueue> | undefined,
    worker: ReturnType<typeof createMessagingWorker> | undefined;
  const logs: string[] = [],
    previousInfo = console.info;
  console.info = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  };
  try {
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const ta = await client.tenant.create({
      data: { name: 'WhatsApp A', status: 'ACTIVE', timezone: 'UTC' },
    });
    const tb = await client.tenant.create({
      data: { name: 'WhatsApp B', status: 'ACTIVE', timezone: 'UTC' },
    });
    const integrations: { id: string; phoneNumberId: string }[] = [];
    for (const [tenantId, phoneNumberId] of [
      [ta.id, '2012345678'],
      [tb.id, '3012345678'],
      [ta.id, '4012345678'],
    ])
      integrations.push(
        await client.integration.create({
          data: {
            tenantId: tenantId!,
            phoneNumberId: phoneNumberId!,
            externalAccountId: '1012345678',
            credentialsReference: 'WHATSAPP_ACCESS_TOKEN_TEST',
          },
        }),
      );
    const cookies: string[] = [],
      users: string[] = [];
    const password = 'senha whatsapp teste seguro',
      passwordHash = await hashPassword(password);
    await client.authThrottle.deleteMany();
    const request = (
      path: string,
      actor = 0,
      body?: unknown,
      method = body === undefined ? 'GET' : 'POST',
    ) =>
      fetch(url + path, {
        method,
        headers: {
          Cookie: cookies[actor] ?? '',
          Origin: process.env.AUTH_ORIGIN!,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    for (const [tenantId, role] of [
      [ta.id, 'CLINIC_ADMIN'],
      [ta.id, 'AGENT'],
      [tb.id, 'CLINIC_ADMIN'],
      [ta.id, 'DOCTOR'],
    ]) {
      const user = await client.user.create({
        data: {
          name: 'Operador WhatsApp',
          email: `${randomUUID()}@example.test`,
          passwordHash,
          memberships: { create: { tenantId: tenantId!, role: role! } },
        },
      });
      users.push(user.id);
      const login = await request('/auth/login', -1, {
        email: user.email,
        password,
      });
      assert.equal(login.status, 200);
      cookies.push(login.headers.get('set-cookie')!.split(';')[0]!);
      assert.equal(
        (await request('/tenancy/active', cookies.length - 1, { tenantId }))
          .status,
        200,
      );
    }
    const frames: Record<string, unknown>[][] = [[], []];
    for (const [index, actor] of [0, 2].entries()) {
      const ws = new WebSocket(url.replace('http:', 'ws:') + '/realtime', {
        headers: { Cookie: cookies[actor]!, Origin: process.env.AUTH_ORIGIN! },
      });
      sockets.push(ws);
      ws.on('message', (data) =>
        frames[index]!.push(
          JSON.parse(String(data)) as Record<string, unknown>,
        ),
      );
      await until(() =>
        frames[index]!.some((f) => f.type === 'realtime.ready'),
      );
    }
    app.get(RealtimeEvents).subscribe((event) => {
      if (
        event.type === 'message.created' &&
        [ta.id, tb.id].includes(event.tenantId)
      )
        committedChecks.push(
          client.message
            .findFirst({
              where: { tenantId: event.tenantId, id: event.messageId },
            })
            .then((row) => {
              assert.ok(row, 'realtime must follow commit');
            }),
        );
    });
    function envelope(
      messages: unknown[] = [],
      which = 0,
      statuses?: unknown[],
    ) {
      return {
        object: 'whatsapp_business_account',
        tenant_id: tb.id,
        entry: [
          {
            id: '1012345678',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    phone_number_id: integrations[which]!.phoneNumberId,
                  },
                  contacts: [
                    {
                      wa_id: '5561999999999',
                      profile: { name: 'Contato recebido' },
                    },
                  ],
                  messages,
                  ...(statuses ? { statuses } : {}),
                },
              },
            ],
          },
        ],
      };
    }
    const incoming = (
      id = 'wamid.' + randomUUID(),
      from = '5561999999999',
    ) => ({
      id,
      from,
      type: 'text',
      text: { body: 'Quero marcar uma consulta.' },
      sender_type: 'AI',
      tenant_id: tb.id,
    });
    async function webhook(body: unknown, signed = true) {
      const raw = typeof body === 'string' ? body : JSON.stringify(body);
      return fetch(url + '/webhooks/whatsapp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(signed
            ? {
                'x-hub-signature-256':
                  'sha256=' +
                  createHmac('sha256', 'test-app-secret')
                    .update(raw)
                    .digest('hex'),
              }
            : {}),
        },
        body: raw,
      });
    }
    let firstConversation = '',
      firstContact = '';
    await t.test(
      'verificação, assinatura, schema, limite e ausência de stack/segredos',
      async () => {
        let r = await fetch(
          url +
            '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=123',
        );
        assert.equal(r.status, 200);
        assert.equal(await r.text(), '123');
        r = await fetch(
          url +
            '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=123',
        );
        assert.equal(r.status, 403);
        assert.equal(
          (await webhook(envelope([incoming()]), false)).status,
          403,
        );
        assert.equal((await webhook('{bad')).status, 400);
        assert.equal((await webhook({ foo: 'x' })).status, 400);
        r = await webhook('x'.repeat(270000));
        assert.equal(r.status, 413);
        assert.ok(!(await r.text()).includes('stack'));
        assert.equal(
          (
            await fetch(url + '/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: '{}',
            })
          ).status,
          403,
        );
      },
    );
    await t.test(
      'novo ingresso identifica tenant, cria Contact/Channel/Conversation/Message sem Patient e publica após commit',
      async () => {
        const before = await client.patient.count({
          where: { tenantId: ta.id },
        });
        const event = incoming('wamid.first');
        assert.equal((await webhook(envelope([event]))).status, 200);
        const message = await client.message.findFirstOrThrow({
          where: { tenantId: ta.id, providerMessageId: event.id },
        });
        firstConversation = message.conversationId;
        assert.equal(message.senderType, 'PATIENT');
        assert.equal(message.deliveryStatus, 'RECEIVED');
        assert.equal(message.senderUserId, null);
        assert.equal(message.content, event.text.body);
        assert.equal(message.integrationId, integrations[0]!.id);
        const conv = await client.conversation.findUniqueOrThrow({
          where: { id: firstConversation },
        });
        firstContact = conv.contactId;
        assert.equal(+conv.lastMessageAt!, +message.createdAt);
        const channel = await client.contactChannel.findFirstOrThrow({
          where: { tenantId: ta.id, contactId: firstContact },
        });
        assert.equal(channel.address, '+5561999999999');
        assert.equal(channel.primary, true);
        assert.equal(channel.providerExternalId, '5561999999999');
        assert.equal(
          await client.patient.count({ where: { tenantId: ta.id } }),
          before,
        );
        await until(() =>
          frames[0]!.some(
            (f) => f.type === 'message.created' && f.messageId === message.id,
          ),
        );
        assert.ok(!frames[1]!.some((f) => f.messageId === message.id));
        await Promise.all(committedChecks);
      },
    );
    await t.test(
      'duplicados e seis webhooks concorrentes criam uma única Message e conversa',
      async () => {
        const before = await client.message.count({
          where: { tenantId: ta.id },
        });
        const body = envelope([incoming('wamid.concurrent')]);
        const responses = await Promise.all(
          Array.from({ length: 6 }, () => webhook(body)),
        );
        assert.deepEqual(
          responses.map((r) => r.status),
          [200, 200, 200, 200, 200, 200],
        );
        assert.equal(
          await client.message.count({ where: { tenantId: ta.id } }),
          before + 1,
        );
        assert.equal(
          await client.conversation.count({
            where: { tenantId: ta.id, contactId: firstContact },
          }),
          1,
        );
        assert.equal(
          (await webhook(envelope([incoming('wamid.first')]))).status,
          200,
        );
      },
    );
    await t.test(
      'mesmo provider_message_id e telefone em outro tenant/número não colidem nem vazam',
      async () => {
        for (const which of [1, 2])
          assert.equal(
            (await webhook(envelope([incoming('wamid.first')], which))).status,
            200,
          );
        const all = await client.message.findMany({
          where: {
            providerMessageId: 'wamid.first',
            tenantId: { in: [ta.id, tb.id] },
          },
        });
        assert.equal(all.length, 3);
        assert.equal(new Set(all.map((m) => m.conversationId)).size, 3);
        assert.equal(
          await client.contact.count({ where: { tenantId: ta.id } }),
          1,
        );
        assert.equal(
          (
            await request(
              `/conversations/${all.find((m) => m.tenantId === tb.id)!.conversationId}`,
            )
          ).status,
          404,
        );
      },
    );
    await t.test(
      'integração ausente, WABA incorreta e integração desativada são ignoradas com segurança',
      async () => {
        const unknown = envelope([incoming('wamid.unknown')]);
        unknown.entry[0]!.changes[0]!.value.metadata.phone_number_id =
          '9999999999';
        assert.equal((await webhook(unknown)).status, 200);
        const wrong = envelope([incoming('wamid.wrong')]);
        wrong.entry[0]!.id = '9999999999';
        assert.equal((await webhook(wrong)).status, 200);
        await client.integration.update({
          where: { id: integrations[2]!.id },
          data: { status: 'DISABLED' },
        });
        assert.equal(
          (await webhook(envelope([incoming('wamid.disabled')], 2))).status,
          200,
        );
        assert.equal(
          await client.message.count({
            where: {
              providerMessageId: {
                in: ['wamid.unknown', 'wamid.wrong', 'wamid.disabled'],
              },
            },
          }),
          0,
        );
      },
    );
    await t.test(
      'PHONE existente recebe WHATSAPP sem perder principal; contato inativo não é reativado',
      async () => {
        const contact = await client.contact.create({
          data: { tenantId: ta.id, displayName: 'Cadastro' },
        });
        await client.contactChannel.create({
          data: {
            tenantId: ta.id,
            contactId: contact.id,
            type: 'PHONE',
            address: '+5561988888888',
            primary: true,
          },
        });
        assert.equal(
          (await webhook(envelope([incoming('wamid.phone', '5561988888888')])))
            .status,
          200,
        );
        assert.equal(
          await client.contactChannel.count({
            where: { tenantId: ta.id, contactId: contact.id },
          }),
          2,
        );
        assert.equal(
          await client.contactChannel.count({
            where: {
              tenantId: ta.id,
              contactId: contact.id,
              primary: true,
              type: 'PHONE',
            },
          }),
          1,
        );
        await client.contact.update({
          where: { id: contact.id },
          data: { status: 'INACTIVE' },
        });
        assert.equal(
          (
            await webhook(
              envelope([incoming('wamid.inactive', '5561988888888')]),
            )
          ).status,
          200,
        );
        assert.equal(
          await client.message.count({
            where: { tenantId: ta.id, providerMessageId: 'wamid.inactive' },
          }),
          0,
        );
      },
    );
    for (const [type, data, expected] of [
      [
        'image',
        { id: '123456', mime_type: 'image/jpeg', caption: 'Legenda' },
        'IMAGE',
      ],
      ['audio', { id: '123457', mime_type: 'audio/ogg' }, 'AUDIO'],
      ['document', { id: '123458', filename: 'arquivo.pdf' }, 'DOCUMENT'],
      ['location', { latitude: -15.7, longitude: -47.9 }, 'LOCATION'],
      [
        'contacts',
        [
          {
            name: { formatted_name: 'Maria' },
            phones: [{ phone: '(61) 99999-9999' }],
          },
        ],
        'CONTACT',
      ],
      [
        'interactive',
        {
          type: 'list_reply',
          list_reply: { id: 'selection', title: 'Escolha' },
        },
        'INTERACTIVE',
      ],
    ] as const)
      await t.test(`persiste ${expected} com metadata limitada`, async () => {
        const id = 'wamid.' + type;
        assert.equal(
          (
            await webhook(
              envelope([{ from: '5561999999999', id, type, [type]: data }]),
            )
          ).status,
          200,
        );
        const row = await client.message.findFirstOrThrow({
          where: { tenantId: ta.id, providerMessageId: id },
        });
        assert.equal(row.messageType, expected);
        assert.ok(JSON.stringify(row.metadata).length < 1000);
        if (type === 'contacts')
          assert.equal(
            (row.metadata as { phone: string }).phone,
            '+5561999999999',
          );
      });
    const op = (action: string, body: unknown = {}, actor = 0) =>
      request(`/conversations/${firstConversation}/${action}`, actor, body);
    const reply = (
      requestId = randomUUID(),
      content = 'Resposta humana',
      actor = 0,
    ) => op('messages', { requestId, messageType: 'TEXT', content }, actor);
    await t.test(
      'outbound mantém RBAC, tenant, ownership e autoria; chave concorrente persiste uma intenção',
      async () => {
        assert.equal((await reply()).status, 403);
        assert.equal(
          (await op('request-human', { reason: 'OTHER' })).status,
          200,
        );
        assert.equal((await op('claim')).status, 200);
        assert.equal(
          (await reply(randomUUID(), 'Outro atendente', 1)).status,
          403,
        );
        assert.equal(
          (await reply(randomUUID(), 'Sem permissão', 3)).status,
          403,
        );
        assert.equal(
          (await reply(randomUUID(), 'Tenant externo', 2)).status,
          404,
        );
        const key = randomUUID();
        const responses = await Promise.all([reply(key), reply(key)]);
        assert.deepEqual(
          responses.map((r) => r.status),
          [201, 201],
        );
        const rows = await client.message.findMany({
          where: { tenantId: ta.id, requestId: key },
        });
        assert.equal(rows.length, 1);
        assert.equal(rows[0]!.senderUserId, users[0]);
        assert.equal(rows[0]!.senderType, 'USER');
        assert.equal(rows[0]!.deliveryStatus, 'PENDING');
        assert.equal(rows[0]!.providerMessageId, null);
        assert.equal((await reply(key, 'Outra intenção')).status, 409);
        const response = JSON.stringify(await responses[0]!.json());
        assert.ok(!response.includes('credentials'));
        assert.ok(!response.includes('test-access'));
      },
    );
    async function makeOutbound(text = 'Envio') {
      const key = randomUUID();
      const r = await reply(key, text);
      assert.equal(r.status, 201);
      return client.message.findFirstOrThrow({
        where: { tenantId: ta.id, requestId: key },
      });
    }
    let calls = 0;
    const sentProvider = new WhatsAppProvider('v23.0', async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body)) as {
        biz_opaque_callback_data: string;
      };
      assert.ok(
        await client.message.findFirst({
          where: {
            tenantId: ta.id,
            id: body.biz_opaque_callback_data,
            deliveryStatus: 'SENDING',
          },
        }),
      );
      return new Response(
        JSON.stringify({
          messages: [{ id: 'wamid.send.' + body.biz_opaque_callback_data }],
        }),
      );
    });
    const deliver = (id: string, provider = sentProvider, tenantId = ta.id) =>
      deliverMessage(client, { tenantId, messageId: id }, provider);
    await t.test(
      'envio só após persistência; concorrência chama provider uma vez; tenant forjado não envia',
      async () => {
        const m = await makeOutbound();
        const before = calls;
        assert.equal(await deliver(m.id, sentProvider, tb.id), null);
        await Promise.all(Array.from({ length: 5 }, () => deliver(m.id)));
        assert.equal(calls, before + 1);
        const row = await client.message.findUniqueOrThrow({
          where: { id: m.id },
        });
        assert.equal(row.deliveryStatus, 'SENT');
        assert.equal(row.providerMessageId, 'wamid.send.' + m.id);
      },
    );
    await t.test(
      'erro transitório mantém mesma Message, usa backoff e termina em cinco tentativas',
      async () => {
        const m = await makeOutbound();
        let attempts = 0;
        const failing = new WhatsAppProvider('v23.0', async () => {
          attempts++;
          return new Response(
            JSON.stringify({
              error: { code: 130429, message: 'PRIVATE test-access-token' },
            }),
            { status: 429 },
          );
        });
        for (let attempt = 1; attempt <= 5; attempt++) {
          await deliver(m.id, failing);
          const row = await client.message.findUniqueOrThrow({
            where: { id: m.id },
          });
          assert.equal(row.sendAttempts, attempt);
          assert.equal(row.deliveryStatus, attempt < 5 ? 'PENDING' : 'FAILED');
          if (attempt < 5) {
            assert.ok(+row.nextAttemptAt! > Date.now());
            await deliver(m.id, failing);
            assert.equal(attempts, attempt);
            await client.message.update({
              where: { id: m.id },
              data: { nextAttemptAt: new Date(0) },
            });
          }
        }
        assert.equal(attempts, 5);
        await deliver(m.id, failing);
        assert.equal(attempts, 5);
        assert.equal(
          await client.message.count({
            where: { tenantId: ta.id, requestId: m.requestId },
          }),
          1,
        );
      },
    );
    await t.test(
      'rejeição permanente e timeout incerto não reenviam nem perdem Message',
      async () => {
        for (const uncertain of [false, true]) {
          const m = await makeOutbound();
          let attempts = 0;
          const p = new WhatsAppProvider('v23.0', async () => {
            attempts++;
            if (uncertain) throw new Error('PRIVATE test-access-token');
            return new Response(
              JSON.stringify({ error: { code: 131047, message: 'PRIVATE' } }),
              { status: 400 },
            );
          });
          await deliver(m.id, p);
          await deliver(m.id, p);
          const row = await client.message.findUniqueOrThrow({
            where: { id: m.id },
          });
          assert.equal(row.deliveryStatus, 'FAILED');
          assert.equal(attempts, 1);
          assert.equal(
            row.errorCode,
            uncertain ? 'SEND_UNCERTAIN' : 'PROVIDER_REJECTED',
          );
        }
      },
    );
    function statusBody(
      id: string,
      status: string,
      messageId?: string,
      which = 0,
    ) {
      return envelope([], which, [
        {
          id,
          status,
          recipient_id: '5561999999999',
          timestamp: String(Math.floor(Date.now() / 1000)),
          ...(messageId ? { biz_opaque_callback_data: messageId } : {}),
        },
      ]);
    }
    await t.test(
      'status delivered/read repetido e fora de ordem é monotônico e isolado por tenant/integração',
      async () => {
        const m = await makeOutbound();
        await deliver(m.id);
        const external = 'wamid.send.' + m.id;
        assert.equal(
          (await webhook(statusBody(external, 'read', m.id, 1))).status,
          200,
        );
        assert.equal(
          (await client.message.findUniqueOrThrow({ where: { id: m.id } }))
            .deliveryStatus,
          'SENT',
        );
        assert.equal(
          (await webhook(statusBody(external, 'delivered'))).status,
          200,
        );
        let row = await client.message.findUniqueOrThrow({
          where: { id: m.id },
        });
        assert.ok(row.deliveredAt);
        assert.equal(row.deliveryStatus, 'DELIVERED');
        assert.equal((await webhook(statusBody(external, 'read'))).status, 200);
        row = await client.message.findUniqueOrThrow({ where: { id: m.id } });
        assert.ok(row.readAt);
        assert.equal(row.deliveryStatus, 'READ');
        const count = await client.authEvent.count({
          where: {
            tenantId: ta.id,
            resourceId: m.id,
            type: 'MESSAGE_RECEIPT_UPDATED',
          },
        });
        for (const status of ['read', 'sent', 'delivered', 'failed'])
          assert.equal(
            (await webhook(statusBody(external, status))).status,
            200,
          );
        assert.equal(
          await client.authEvent.count({
            where: {
              tenantId: ta.id,
              resourceId: m.id,
              type: 'MESSAGE_RECEIPT_UPDATED',
            },
          }),
          count,
        );
        await until(() =>
          frames[0]!.some(
            (f) => f.type === 'message.status_updated' && f.messageId === m.id,
          ),
        );
        assert.ok(!frames[1]!.some((f) => f.messageId === m.id));
      },
    );
    await t.test(
      'callback precoce e resultado incerto reconciliam por UUID somente no destino correto',
      async () => {
        const m = await makeOutbound();
        const p = new WhatsAppProvider('v23.0', async () => {
          assert.equal(
            (await webhook(statusBody('wamid.early', 'read', m.id))).status,
            200,
          );
          throw new Error('timeout');
        });
        await deliver(m.id, p);
        assert.equal(
          (await client.message.findUniqueOrThrow({ where: { id: m.id } }))
            .deliveryStatus,
          'READ',
        );
        const untouched = await makeOutbound();
        await webhook(statusBody('wamid.forged', 'read', untouched.id));
        assert.equal(
          (
            await client.message.findUniqueOrThrow({
              where: { id: untouched.id },
            })
          ).deliveryStatus,
          'PENDING',
        );
      },
    );
    await t.test(
      'failed persiste falha; recibo tardio reconcilia timeout sem novo envio',
      async () => {
        const failed = await makeOutbound();
        await deliver(failed.id);
        assert.equal(
          (await webhook(statusBody('wamid.send.' + failed.id, 'failed')))
            .status,
          200,
        );
        assert.equal(
          (await client.message.findUniqueOrThrow({ where: { id: failed.id } }))
            .deliveryStatus,
          'FAILED',
        );
        const uncertain = await makeOutbound();
        await deliver(
          uncertain.id,
          new WhatsAppProvider('v23.0', async () => {
            throw new Error('timeout');
          }),
        );
        assert.equal(
          (
            await client.message.findUniqueOrThrow({
              where: { id: uncertain.id },
            })
          ).errorCode,
          'SEND_UNCERTAIN',
        );
        const mismatch = statusBody(
          'wamid.reconcile',
          'delivered',
          uncertain.id,
        );
        mismatch.entry[0]!.changes[0]!.value.statuses![0] = {
          id: 'wamid.reconcile',
          status: 'delivered',
          recipient_id: '5561988888888',
          timestamp: String(Math.floor(Date.now() / 1000)),
          biz_opaque_callback_data: uncertain.id,
        };
        await webhook(mismatch);
        assert.equal(
          (
            await client.message.findUniqueOrThrow({
              where: { id: uncertain.id },
            })
          ).deliveryStatus,
          'FAILED',
        );
        await webhook(statusBody('wamid.reconcile', 'delivered', uncertain.id));
        assert.equal(
          (
            await client.message.findUniqueOrThrow({
              where: { id: uncertain.id },
            })
          ).deliveryStatus,
          'DELIVERED',
        );
      },
    );
    await t.test(
      'callback failed confirma erro antes incerto sem duplicar audit',
      async () => {
        const m = await makeOutbound();
        await deliver(
          m.id,
          new WhatsAppProvider('v23.0', async () => {
            throw new Error('timeout');
          }),
        );
        const body = statusBody('wamid.confirmed-failure', 'failed', m.id);
        await webhook(body);
        await webhook(body);
        const row = await client.message.findUniqueOrThrow({
          where: { id: m.id },
        });
        assert.equal(row.providerMessageId, 'wamid.confirmed-failure');
        assert.equal(row.errorCode, 'PROVIDER_DELIVERY_FAILED');
        assert.equal(
          await client.authEvent.count({
            where: {
              tenantId: ta.id,
              resourceId: m.id,
              type: 'MESSAGE_RECEIPT_UPDATED',
            },
          }),
          1,
        );
      },
    );
    await t.test(
      'lease vencido é falha incerta, sem reenvio automático',
      async () => {
        const m = await makeOutbound();
        await client.message.update({
          where: { id: m.id },
          data: {
            deliveryStatus: 'SENDING',
            sendAttempts: 1,
            sendingAt: new Date(),
            nextAttemptAt: new Date(0),
          },
        });
        const before = calls;
        assert.ok(await deliver(m.id));
        assert.equal(calls, before);
        assert.equal(
          (await client.message.findUniqueOrThrow({ where: { id: m.id } }))
            .errorCode,
          'SEND_UNCERTAIN',
        );
        assert.equal(await deliver(m.id), null);
      },
    );
    await t.test(
      'worker revalida ownership e revogação antes de enviar',
      async () => {
        const m = await makeOutbound();
        await op('transfer', { targetUserId: users[1] });
        const before = calls;
        await deliver(m.id);
        assert.equal(calls, before);
        assert.equal(
          (await client.message.findUniqueOrThrow({ where: { id: m.id } }))
            .errorCode,
          'AUTHORIZATION_CHANGED',
        );
        await op('transfer', { targetUserId: users[0] });
        const revoked = await makeOutbound();
        await client.userTenant.update({
          where: { userId_tenantId: { userId: users[0]!, tenantId: ta.id } },
          data: { active: false },
        });
        await deliver(revoked.id);
        assert.equal(
          (
            await client.message.findUniqueOrThrow({
              where: { id: revoked.id },
            })
          ).errorCode,
          'AUTHORIZATION_CHANGED',
        );
        await client.userTenant.update({
          where: { userId_tenantId: { userId: users[0]!, tenantId: ta.id } },
          data: { active: true },
        });
      },
    );
    await t.test(
      'BullMQ real recupera intenção e conclusão atualiza WebSocket existente',
      async () => {
        const m = await makeOutbound();
        queue = createMessagingQueue(redis);
        await dispatchMessages(client, queue);
        const lost = await queue.getJob(`${m.id}-0`);
        assert.ok(lost);
        assert.deepEqual(lost.data, { tenantId: ta.id, messageId: m.id });
        await lost.remove();
        await dispatchMessages(client, queue);
        assert.ok(await queue.getJob(`${m.id}-0`));
        worker = createMessagingWorker(client, redis, sentProvider);
        await until(
          async () =>
            (await client.message.findUniqueOrThrow({ where: { id: m.id } }))
              .deliveryStatus === 'SENT',
        );
        await until(() =>
          frames[0]!.some(
            (f) => f.type === 'message.status_updated' && f.messageId === m.id,
          ),
        );
        await worker.close();
        worker = undefined;
      },
    );
    await t.test(
      'após resolução, novo ingresso cria conversa sem reabrir histórico',
      async () => {
        const contact = await client.contact.findFirstOrThrow({
          where: { tenantId: ta.id, id: firstContact },
        });
        const other = await client.conversation.create({
          data: {
            tenantId: ta.id,
            contactId: contact.id,
            integrationId: integrations[2]!.id,
            status: 'RESOLVED',
            resolvedAt: new Date(),
          },
        });
        await client.integration.update({
          where: { id: integrations[2]!.id },
          data: { status: 'ACTIVE' },
        });
        const open = await client.conversation.findFirstOrThrow({
          where: {
            tenantId: ta.id,
            integrationId: integrations[2]!.id,
            status: 'AI_ACTIVE',
          },
        });
        await client.conversation.update({
          where: { id: open.id },
          data: { status: 'RESOLVED', resolvedAt: new Date() },
        });
        await webhook(envelope([incoming('wamid.new-cycle')], 2));
        const message = await client.message.findFirstOrThrow({
          where: {
            tenantId: ta.id,
            integrationId: integrations[2]!.id,
            providerMessageId: 'wamid.new-cycle',
          },
        });
        assert.notEqual(message.conversationId, open.id);
        assert.notEqual(message.conversationId, other.id);
        assert.equal(
          (
            await client.conversation.findUniqueOrThrow({
              where: { id: open.id },
            })
          ).status,
          'RESOLVED',
        );
      },
    );
    await t.test(
      'erro de credencial marca Integration ERROR; recebimento continua e segredos não vazam',
      async () => {
        const m = await makeOutbound();
        const p = new WhatsAppProvider(
          'v23.0',
          async () =>
            new Response(
              JSON.stringify({
                error: { code: 190, message: 'test-access-token PRIVATE' },
              }),
              { status: 401 },
            ),
        );
        await deliver(m.id, p);
        assert.equal(
          (
            await client.integration.findUniqueOrThrow({
              where: { id: integrations[0]!.id },
            })
          ).status,
          'ERROR',
        );
        assert.equal(
          (await webhook(envelope([incoming('wamid.after-error')]))).status,
          200,
        );
        const audit = JSON.stringify(
          await client.authEvent.findMany({
            where: { tenantId: { in: [ta.id, tb.id] } },
          }),
        );
        const responses = JSON.stringify(
          await (
            await request(`/inbox/conversations/${firstConversation}/messages`)
          ).json(),
        );
        for (const text of [
          audit,
          responses,
          logs.join('\n'),
          JSON.stringify(frames),
        ])
          for (const secret of [
            'test-access-token',
            'test-app-secret',
            'test-verify-token',
            'PRIVATE',
          ])
            assert.ok(!text.includes(secret));
      },
    );
    await t.test(
      'FKs e constraints recusam associação cross-tenant e alteração do número da conversa',
      async () => {
        await assert.rejects(
          client.conversation.create({
            data: {
              tenantId: ta.id,
              contactId: firstContact,
              integrationId: integrations[1]!.id,
            },
          }),
        );
        await assert.rejects(
          client.conversation.update({
            where: { id: firstConversation },
            data: { integrationId: integrations[2]!.id },
          }),
        );
        await assert.rejects(
          client.message.create({
            data: {
              tenantId: ta.id,
              conversationId: firstConversation,
              channel: 'WHATSAPP',
              senderType: 'PATIENT',
              messageType: 'TEXT',
              content: 'inválido',
              integrationId: integrations[1]!.id,
            },
          }),
        );
        await assert.rejects(
          client.integration.create({
            data: {
              tenantId: tb.id,
              phoneNumberId: integrations[0]!.phoneNumberId,
              externalAccountId: '1012345678',
              credentialsReference: 'WHATSAPP_ACCESS_TOKEN_TEST',
            },
          }),
        );
        await assert.rejects(
          client.message.create({
            data: {
              tenantId: ta.id,
              conversationId: firstConversation,
              integrationId: integrations[0]!.id,
              channel: 'WHATSAPP',
              senderType: 'USER',
              senderUserId: users[0]!,
              messageType: 'TEXT',
              content: 'sem destinatário',
              deliveryStatus: 'PENDING',
              nextAttemptAt: new Date(),
            },
          }),
        );
        assert.ok(await databaseNow(client));
      },
    );
    await Promise.all(committedChecks);
  } finally {
    for (const socket of sockets) socket.terminate();
    await worker?.close();
    await queue?.close();
    await app.close();
    await client.$disconnect();
    console.info = previousInfo;
    for (const [key, value] of Object.entries({
      WHATSAPP_APP_SECRET: original.secret,
      WHATSAPP_VERIFY_TOKEN: original.verify,
      WHATSAPP_GRAPH_VERSION: original.version,
      WHATSAPP_ACCESS_TOKEN_TEST: original.token,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
