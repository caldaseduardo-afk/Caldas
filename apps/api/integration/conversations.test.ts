import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { createDatabaseClient, type Prisma } from '@atendente/database';
import { createApplication } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { tokenHash } from '../src/auth/auth.service';
import type { AuthRequest } from '../src/auth/auth.guard';
import type { DatabaseService } from '../src/auth/database.service';
import { TenantContext } from '../src/tenancy/tenant.context';
import { AuthorizationService } from '../src/permissions/authorization.service';
import { civilDate } from '../src/availability/availability.dto';
import { ConversationRepository } from '../src/conversations/conversation.repository';
import { ConversationsService } from '../src/conversations/conversations.service';
const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).pathname !== '/task002_test' ||
  connection !== process.env.DATABASE_URL
)
  throw new Error('Use pnpm db:test.');
interface Conversation {
  id: string;
  contactId: string;
  activePatientId: string | null;
  status: string;
  intent: string;
  assignedUserId: string | null;
  handoffReason: string | null;
  lastMessageAt: string | null;
}
interface Message {
  id: string;
  conversationId: string;
  senderType: string;
  senderUserId: string | null;
  content: string;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
}
interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  hasMore: boolean;
}
test('Conversas e mensagens: tenant, autoria, idempotência, estados, ordem e atomicidade', async (t) => {
  const client = createDatabaseClient(connection),
    app = await createApplication(),
    app2 = await createApplication();
  try {
    await app.listen(0, '127.0.0.1');
    await app2.listen(0, '127.0.0.1');
    const url = await app.getUrl(),
      url2 = await app2.getUrl();
    const ta = await client.tenant.create({
        data: {
          name: 'Conversas A',
          status: 'ACTIVE',
          timezone: 'America/Sao_Paulo',
        },
      }),
      tb = await client.tenant.create({
        data: { name: 'Conversas B', status: 'ACTIVE', timezone: 'UTC' },
      });
    const ca = await client.contact.create({
        data: { tenantId: ta.id, displayName: 'Contato A' },
      }),
      cb = await client.contact.create({
        data: { tenantId: tb.id, displayName: 'Contato B' },
      }),
      ca2 = await client.contact.create({
        data: { tenantId: ta.id, displayName: 'Outro contato' },
      });
    const pa = await client.patient.create({
        data: {
          tenantId: ta.id,
          name: 'Paciente A',
          birthDate: civilDate('2000-01-01'),
        },
      }),
      pb = await client.patient.create({
        data: {
          tenantId: tb.id,
          name: 'Paciente B',
          birthDate: civilDate('2000-01-01'),
        },
      }),
      pa2 = await client.patient.create({
        data: {
          tenantId: ta.id,
          name: 'Sem vínculo',
          birthDate: civilDate('2000-01-01'),
        },
      });
    const password = 'senha longa conversas teste',
      passwordHash = await hashPassword(password),
      users: { id: string; email: string; name: string }[] = [];
    for (const [tenantId, role] of [
      [ta.id, 'AGENT'],
      [tb.id, 'CLINIC_ADMIN'],
      [ta.id, 'DOCTOR'],
      [ta.id, 'CLINIC_ADMIN'],
    ] as const)
      users.push(
        await client.user.create({
          data: {
            name: role,
            email: `${randomUUID()}@example.test`,
            passwordHash,
            memberships: { create: { tenantId, role } },
          },
        }),
      );
    const link = await client.contactPatient.create({
      data: {
        tenantId: ta.id,
        contactId: ca.id,
        patientId: pa.id,
        relationshipType: 'MOTHER',
        relationshipStatus: 'VERIFIED',
        authorizationLevel: 'SCHEDULING_ONLY',
        authorizedBy: users[3]!.id,
        authorizedAt: new Date(),
      },
    });
    const request = (
      path: string,
      cookie = '',
      method = 'GET',
      body?: unknown,
      server = url,
      origin = process.env.AUTH_ORIGIN!,
    ) =>
      fetch(server + path, {
        method,
        headers: {
          Cookie: cookie,
          Origin: origin,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    await client.authThrottle.deleteMany();
    const login = async (i: number, tenantId: string) => {
      const r = await request('/auth/login', '', 'POST', {
        email: users[i]!.email,
        password,
      });
      assert.equal(r.status, 200);
      const cookie = r.headers.get('set-cookie')!.split(';')[0]!;
      assert.equal(
        (await request('/tenancy/active', cookie, 'POST', { tenantId })).status,
        200,
      );
      return cookie;
    };
    const a = await login(0, ta.id),
      b = await login(1, tb.id),
      doctor = await login(2, ta.id),
      admin = await login(3, ta.id);
    const context = async (index: number, cookie: string, tenantId: string) => {
      const session = await client.authSession.findUniqueOrThrow({
        where: { tokenHash: tokenHash(cookie.split('=')[1]!) },
      });
      const database = { client } as DatabaseService;
      const auth = new AuthorizationService(
        database,
        new TenantContext(
          {
            identity: users[index],
            sessionId: session.id,
            activeTenantId: tenantId,
          } as AuthRequest,
          database,
        ),
      );
      const repo = new ConversationRepository(database, auth);
      return {
        database,
        auth,
        repo,
        service: new ConversationsService(repo, auth),
      };
    };
    const internal = await context(0, a, ta.id),
      internalB = await context(1, b, tb.id);
    const create = async (contactId = ca.id, cookie = a) => {
      const r = await request('/conversations', cookie, 'POST', { contactId });
      assert.equal(r.status, 200, await r.clone().text());
      return (await r.json()) as Conversation;
    };
    const prepareHuman = async (id: string, cookie = a) => {
      const row = await client.conversation.findUniqueOrThrow({
        where: { id },
      });
      if (row.status === 'AI_ACTIVE') {
        assert.equal(
          (
            await request(
              `/conversations/${id}/request-human`,
              cookie,
              'POST',
              { reason: 'OTHER' },
            )
          ).status,
          200,
        );
        assert.equal(
          (await request(`/conversations/${id}/claim`, cookie, 'POST', {}))
            .status,
          200,
        );
      }
    };
    const reply = async (id: string, content = 'Olá', cookie = a) => {
      await prepareHuman(id, cookie);
      const r = await request(`/conversations/${id}/messages`, cookie, 'POST', {
        messageType: 'TEXT',
        content,
      });
      assert.equal(r.status, 201, await r.clone().text());
      return (await r.json()) as Message;
    };
    const status = (
      id: string,
      value: string,
      extra: Record<string, unknown> = {},
    ) =>
      request(`/conversations/${id}/status`, a, 'POST', {
        status: value,
        ...extra,
      });
    let conversation: Conversation,
      foreign: Conversation,
      other: Conversation,
      first: Message,
      foreignMessage: Message;
    await t.test(
      'obter/criar concorrente gera uma aberta por contato; tenant próprio e estado inicial',
      async () => {
        const results = await Promise.all([
          request('/conversations', a, 'POST', { contactId: ca.id }),
          request('/conversations', a, 'POST', { contactId: ca.id }, url2),
        ]);
        assert.ok(results.every((x) => x.status === 200));
        const rows = await Promise.all(
          results.map(async (r) => (await r.json()) as Conversation),
        );
        assert.equal(rows[0]!.id, rows[1]!.id);
        conversation = rows[0]!;
        assert.equal(conversation.activePatientId, null);
        assert.equal(conversation.status, 'AI_ACTIVE');
        assert.equal(conversation.intent, 'OTHER');
        assert.equal(conversation.lastMessageAt, null);
        assert.equal(conversation.assignedUserId, null);
        assert.equal(
          await client.conversation.count({
            where: { tenantId: ta.id, contactId: ca.id },
          }),
          1,
        );
        foreign = await create(cb.id, b);
        other = await create(ca2.id);
        assert.equal(
          (await request('/conversations', a, 'POST', { contactId: cb.id }))
            .status,
          404,
        );
        assert.equal(
          (
            await request('/conversations', a, 'POST', {
              contactId: ca.id,
              tenantId: tb.id,
            })
          ).status,
          400,
        );
        assert.ok(!('tenantId' in conversation));
        assert.ok(!('contact' in conversation));
      },
    );
    await t.test(
      'paciente ativo é contexto, intenção independente e vínculo não concede leitura clínica',
      async () => {
        const r = await request(
          `/conversations/${conversation.id}`,
          a,
          'PATCH',
          { activePatientId: pa.id, intent: 'SCHEDULING' },
        );
        assert.equal(r.status, 200);
        const updated = (await r.json()) as Conversation;
        assert.equal(updated.id, conversation.id);
        assert.equal(updated.activePatientId, pa.id);
        assert.equal(updated.intent, 'SCHEDULING');
        assert.equal(updated.status, 'AI_ACTIVE');
        assert.equal(
          (await request(`/contacts/${ca.id}/patients/${pa.id}`, a)).status,
          404,
        );
        for (const activePatientId of [pb.id, pa2.id])
          assert.equal(
            (
              await request(`/conversations/${conversation.id}`, a, 'PATCH', {
                activePatientId,
              })
            ).status,
            404,
          );
        await client.contactPatient.update({
          where: { id: link.id },
          data: { authorizationLevel: 'NO_ACCESS' },
        });
        assert.equal(
          (
            await request(`/conversations/${conversation.id}`, a, 'PATCH', {
              activePatientId: pa.id,
            })
          ).status,
          404,
        );
        assert.equal(
          (await request(`/contacts/${ca.id}/patients/${pa.id}`, a)).status,
          404,
        );
        await client.contactPatient.update({
          where: { id: link.id },
          data: { authorizationLevel: 'SCHEDULING_ONLY' },
        });
        assert.equal(
          (
            await request(`/conversations/${conversation.id}`, a, 'PATCH', {
              intent: 'PAYMENT',
            })
          ).status,
          200,
        );
        assert.equal((await create()).id, conversation.id);
      },
    );
    await t.test(
      'autoria pública USER da sessão; PATIENT/AI/SYSTEM internos e sem fake user',
      async () => {
        first = await reply(conversation.id);
        assert.equal(first.senderType, 'USER');
        assert.equal(first.senderUserId, users[0]!.id);
        const patient = await internal.service.persistIncoming(
          conversation.id,
          {
            providerMessageId: 'ABC123',
            messageType: 'TEXT',
            content: 'Recebida',
          },
        );
        assert.equal(patient.senderType, 'PATIENT');
        assert.equal(patient.senderUserId, null);
        await internal.service.handoff(conversation.id, 'return-to-ai', {});
        const ai = await internal.service.persistAssistant(conversation.id, {
          messageType: 'TEXT',
          content: 'Resposta preparada',
        });
        assert.equal(ai.senderType, 'AI');
        assert.equal(ai.senderUserId, null);
        await prepareHuman(conversation.id);
        const system = await internal.service.persistSystem(conversation.id, {
          messageType: 'TEXT',
          content: 'Evento interno',
        });
        assert.equal(system.senderType, 'SYSTEM');
        assert.equal(system.senderUserId, null);
        const again = await internal.service.persistSystem(conversation.id, {
          messageType: 'TEXT',
          content: 'Evento interno',
        });
        assert.notEqual(again.id, system.id);
        foreignMessage = await reply(foreign.id, 'Conteúdo secreto B', b);
        for (const extra of [
          { senderType: 'AI' },
          { senderType: 'SYSTEM' },
          { senderUserId: users[1]!.id },
          { providerMessageId: 'forged' },
          { createdAt: '2000-01-01T00:00:00Z' },
          { tenantId: tb.id },
        ])
          assert.equal(
            (
              await request(
                `/conversations/${conversation.id}/messages`,
                a,
                'POST',
                { messageType: 'TEXT', content: 'Olá', ...extra },
              )
            ).status,
            400,
          );
        assert.ok(!('tenantId' in first));
        assert.ok(!('providerMessageId' in first));
      },
    );
    await t.test(
      'idempotência externa serial e concorrente, tenant/canal e payload incompatível',
      async () => {
        const dto = {
          providerMessageId: 'CONCURRENT',
          messageType: 'IMAGE',
          content: 'Foto',
          metadata: { mediaRef: 'asset:123', mimeType: 'image/png' },
        };
        const messages = await Promise.all([
          internal.service.persistIncoming(conversation.id, dto),
          internal.service.persistIncoming(conversation.id, {
            ...dto,
            metadata: { mimeType: 'image/png', mediaRef: 'asset:123' },
          }),
        ]);
        assert.equal(messages[0]!.id, messages[1]!.id);
        const before = (
          await client.conversation.findUniqueOrThrow({
            where: { id: conversation.id },
          })
        ).lastMessageAt;
        const repeated = await internal.service.persistIncoming(
          conversation.id,
          dto,
        );
        assert.equal(repeated.id, messages[0]!.id);
        assert.deepEqual(
          (
            await client.conversation.findUniqueOrThrow({
              where: { id: conversation.id },
            })
          ).lastMessageAt,
          before,
        );
        assert.equal(
          await client.message.count({
            where: { tenantId: ta.id, providerMessageId: 'CONCURRENT' },
          }),
          1,
        );
        assert.equal(
          await client.authEvent.count({
            where: {
              tenantId: ta.id,
              resourceId: repeated.id,
              type: 'MESSAGE_CREATED',
            },
          }),
          1,
        );
        await assert.rejects(
          internal.service.persistIncoming(conversation.id, {
            ...dto,
            content: 'Diferente',
          }),
        );
        await assert.rejects(internal.service.persistIncoming(other.id, dto));
        const foreignSame = await internalB.service.persistIncoming(
          foreign.id,
          dto,
        );
        assert.notEqual(foreignSame.id, repeated.id);
      },
    );
    await t.test(
      'tipos não textuais persistem referências estruturadas, sem binários',
      async () => {
        for (const messageType of ['IMAGE', 'AUDIO', 'DOCUMENT']) {
          const r = await request(
            `/conversations/${conversation.id}/messages`,
            a,
            'POST',
            {
              messageType,
              metadata: {
                mediaRef: 'asset:xyz',
                fileName: 'arquivo',
                sizeBytes: 123,
              },
            },
          );
          assert.equal(r.status, 201);
          const row = (await r.json()) as Message;
          assert.equal(row.content, '');
        }
        for (const [messageType, metadata] of [
          ['LOCATION', { latitude: -15, longitude: -47 }],
          ['CONTACT', { displayName: 'Fulano', phone: '+5561999999999' }],
          ['INTERACTIVE', { interactionId: 'choice', selectionId: 'yes' }],
        ] as const)
          assert.equal(
            (
              await request(
                `/conversations/${conversation.id}/messages`,
                a,
                'POST',
                { messageType, metadata },
              )
            ).status,
            201,
          );
        assert.equal(
          (
            await request(
              `/conversations/${conversation.id}/messages`,
              a,
              'POST',
              {
                messageType: 'IMAGE',
                metadata: { mediaRef: 'data:image/png;base64,abc' },
              },
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              `/conversations/${conversation.id}/messages`,
              a,
              'POST',
              { messageType: 'DOCUMENT', metadata: { binary: [0, 1, 2] } },
            )
          ).status,
          400,
        );
      },
    );
    await t.test(
      'lastMessageAt atômico e ordem cronológica estável, inclusive timestamps iguais',
      async () => {
        const results = await Promise.all([
          request(`/conversations/${conversation.id}/messages`, a, 'POST', {
            messageType: 'TEXT',
            content: 'A',
          }),
          request(
            `/conversations/${conversation.id}/messages`,
            a,
            'POST',
            { messageType: 'TEXT', content: 'B' },
            url2,
          ),
        ]);
        assert.ok(results.every((r) => r.status === 201));
        const createdAt = new Date('2020-01-01T00:00:00Z');
        const ids = [randomUUID(), randomUUID()].sort();
        for (const id of ids.slice().reverse())
          await client.message.create({
            data: {
              id,
              tenantId: ta.id,
              conversationId: conversation.id,
              channel: 'WHATSAPP',
              senderType: 'SYSTEM',
              messageType: 'TEXT',
              content: 'Empate',
              createdAt,
            },
          });
        const firstPage = (await (
          await request(
            `/conversations/${conversation.id}/messages?limit=1&page=1`,
            a,
          )
        ).json()) as Page<Message>;
        const secondPage = (await (
          await request(
            `/conversations/${conversation.id}/messages?limit=1&page=2`,
            a,
          )
        ).json()) as Page<Message>;
        assert.equal(firstPage.items[0]!.id, ids[0]);
        assert.equal(secondPage.items[0]!.id, ids[1]);
        assert.equal(firstPage.hasMore, true);
        const list = (await (
          await request(
            `/conversations/${conversation.id}/messages?limit=100`,
            a,
          )
        ).json()) as Page<Message>;
        assert.ok(
          list.items.every(
            (m, i) => i === 0 || m.createdAt >= list.items[i - 1]!.createdAt,
          ),
        );
        const last = await client.message.aggregate({
          where: { tenantId: ta.id, conversationId: conversation.id },
          _max: { createdAt: true },
        });
        const persisted = await client.conversation.findUniqueOrThrow({
          where: { id: conversation.id },
        });
        assert.deepEqual(persisted.lastMessageAt, last._max.createdAt);
        assert.equal(
          (
            await request(
              `/conversations/${conversation.id}/messages?limit=101`,
              a,
            )
          ).status,
          400,
        );
      },
    );
    await t.test(
      'listagem paginada e filtros de inbox permanecem no tenant',
      async () => {
        for (const filter of [
          `contactId=${ca.id}`,
          'intent=PAYMENT',
          `activePatientId=${pa.id}`,
          'status=AI_ACTIVE',
          'channel=WHATSAPP',
        ]) {
          const r = await request(`/conversations?${filter}&limit=1`, a);
          assert.equal(r.status, 200);
          const page = (await r.json()) as Page<Conversation>;
          assert.ok(page.items.length <= 1);
          assert.ok(page.items.every((x) => x.id !== foreign.id));
        }
        for (const filter of [
          `contactId=${cb.id}`,
          `activePatientId=${pb.id}`,
          `assignedUserId=${users[1]!.id}`,
        ])
          assert.equal(
            (
              (await (
                await request(`/conversations?${filter}`, a)
              ).json()) as Page<Conversation>
            ).items.length,
            0,
          );
        const all = (await (
          await request('/conversations', a)
        ).json()) as Page<Conversation>;
        assert.equal(all.items.length, 2);
        assert.ok(all.items.every((x) => x.id !== foreign.id));
        assert.equal(
          (await request('/conversations?tenantId=' + tb.id, a)).status,
          400,
        );
      },
    );
    await t.test(
      'estados mínimos, atribuição pelo handoff e IA suspensa em HUMAN_ACTIVE',
      async () => {
        await internal.service.handoff(conversation.id, 'return-to-ai', {});
        await internal.service.handoff(conversation.id, 'request-human', {
          reason: 'USER_REQUESTED_HUMAN',
        });
        assert.equal(
          (
            await status(conversation.id, 'HUMAN_ACTIVE', {
              assignedUserId: users[0]!.id,
            })
          ).status,
          400,
        );
        for (const assignedUserId of [users[1]!.id, users[2]!.id, randomUUID()])
          await assert.rejects(
            internal.service.internalStatus(conversation.id, {
              status: 'HUMAN_ACTIVE',
              assignedUserId,
            }),
          );
        const assigned = await internal.service.handoff(
          conversation.id,
          'claim',
          {},
        );
        assert.equal(assigned.assignedUserId, users[0]!.id);
        assert.equal(assigned.handoffReason, null);
        const filtered = (await (
          await request(`/conversations?assignedUserId=${users[0]!.id}`, a)
        ).json()) as Page<Conversation>;
        assert.equal(filtered.items[0]!.id, conversation.id);
        await assert.rejects(
          internal.service.persistAssistant(conversation.id, {
            messageType: 'TEXT',
            content: 'Não pode responder',
          }),
        );
        await internal.service.handoff(conversation.id, 'return-to-ai', {});
        assert.equal(
          (await status(conversation.id, 'WAITING_PATIENT')).status,
          200,
        );
        assert.equal((await status(conversation.id, 'AI_ACTIVE')).status, 200);
        assert.equal((await status(conversation.id, 'RESOLVED')).status, 200);
        assert.equal((await status(conversation.id, 'AI_ACTIVE')).status, 409);
        assert.equal((await status(conversation.id, 'CLOSED')).status, 200);
        assert.equal((await status(conversation.id, 'AI_ACTIVE')).status, 409);
        assert.equal(
          (
            await request(`/conversations/${conversation.id}`, a, 'PATCH', {
              intent: 'OTHER',
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await request(
              `/conversations/${conversation.id}/messages`,
              a,
              'POST',
              { messageType: 'TEXT', content: 'Nova' },
            )
          ).status,
          409,
        );
        const duplicate = await internal.service.persistIncoming(
          conversation.id,
          {
            providerMessageId: 'ABC123',
            messageType: 'TEXT',
            content: 'Recebida',
          },
        );
        assert.equal(duplicate.content, 'Recebida');
        const fresh = await create();
        assert.notEqual(fresh.id, conversation.id);
        assert.equal(fresh.activePatientId, null);
      },
    );
    await t.test(
      'recibos internos coerentes, idempotentes, leitura implica entrega; não há endpoint público',
      async () => {
        // Use the same clock as the repository; host/container clocks may differ.
        const receiptNow = async () =>
          (
            await client.$queryRaw<
              Array<{ now: Date }>
            >`SELECT clock_timestamp() AS now`
          )[0]!.now.toISOString();
        const at = await receiptNow();
        const delivered = await internal.service.recordReceipt(
          conversation.id,
          first.id,
          { kind: 'DELIVERED', at },
        );
        assert.equal(delivered.deliveredAt!.toISOString(), at);
        const readAt = await receiptNow();
        const read = await internal.service.recordReceipt(
          conversation.id,
          first.id,
          { kind: 'READ', at: readAt },
        );
        assert.equal(read.readAt!.toISOString(), readAt);
        assert.ok(read.readAt! >= read.deliveredAt!);
        await internal.service.recordReceipt(conversation.id, first.id, {
          kind: 'READ',
          at: readAt,
        });
        assert.equal(
          await client.authEvent.count({
            where: {
              tenantId: ta.id,
              resourceId: first.id,
              type: 'MESSAGE_RECEIPT_UPDATED',
            },
          }),
          2,
        );
        await assert.rejects(
          internal.service.recordReceipt(conversation.id, first.id, {
            kind: 'READ',
            at: '2000-01-01T00:00:00Z',
          }),
        );
        await assert.rejects(
          internal.service.recordReceipt(conversation.id, first.id, {
            kind: 'READ',
            at: '2099-01-01T00:00:00Z',
          }),
        );
        const m = await reply(other.id);
        const readOnly = await internal.service.recordReceipt(other.id, m.id, {
          kind: 'READ',
          at: await receiptNow(),
        });
        assert.deepEqual(readOnly.readAt, readOnly.deliveredAt);
        const incoming = await internal.service.persistIncoming(other.id, {
          providerMessageId: 'READ-INCOMING',
          messageType: 'TEXT',
          content: 'x',
        });
        await assert.rejects(
          internal.service.recordReceipt(other.id, incoming.id, {
            kind: 'READ',
            at: await receiptNow(),
          }),
        );
        assert.equal(
          (
            await request(
              `/conversations/${other.id}/messages/${m.id}/read`,
              a,
              'POST',
              {},
            )
          ).status,
          404,
        );
      },
    );
    await t.test(
      'isolamento por IDs, RBAC, CSRF e validação no SQL',
      async () => {
        for (const path of [
          `/conversations/${foreign.id}`,
          `/conversations/${foreign.id}/messages`,
          `/conversations/${foreign.id}/messages/${foreignMessage.id}`,
          `/conversations/${conversation.id}/messages/${foreignMessage.id}`,
        ]) {
          const r = await request(path, a);
          assert.equal(r.status, 404);
          assert.ok(!(await r.text()).includes('secreto'));
        }
        assert.equal(
          (
            await request(`/conversations/${foreign.id}`, a, 'PATCH', {
              intent: 'OTHER',
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await request(`/conversations/${foreign.id}/messages`, a, 'POST', {
              messageType: 'TEXT',
              content: 'x',
            })
          ).status,
          404,
        );
        await assert.rejects(
          internal.service.persistIncoming(foreign.id, {
            providerMessageId: 'FOREIGN',
            messageType: 'TEXT',
            content: 'x',
          }),
        );
        assert.equal((await request('/conversations')).status, 401);
        assert.equal((await request('/conversations', doctor)).status, 403);
        assert.equal(
          (
            await request('/conversations', doctor, 'POST', {
              contactId: ca.id,
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              `/conversations/${other.id}/messages`,
              doctor,
              'POST',
              { messageType: 'TEXT', content: 'x' },
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              '/conversations',
              a,
              'POST',
              { contactId: ca.id },
              url,
              'https://evil.test',
            )
          ).status,
          403,
        );
        assert.equal((await request('/conversations', admin)).status, 200);
        const raw = {
          tenantId: ta.id,
          conversationId: other.id,
          channel: 'WHATSAPP' as const,
          senderType: 'USER' as const,
          senderUserId: users[0]!.id,
          messageType: 'TEXT' as const,
          content: 'SQL',
        };
        for (const patch of [
          { conversationId: foreign.id },
          { senderUserId: users[1]!.id },
          { senderUserId: null },
          { senderType: 'AI' as const },
          { content: '' },
          { readAt: new Date() },
          { deliveredAt: new Date('2000-01-01T00:00:00Z') },
        ])
          await assert.rejects(
            client.message.create({ data: { ...raw, ...patch } }),
          );
        await assert.rejects(
          client.conversation.create({
            data: { tenantId: ta.id, contactId: cb.id },
          }),
        );
        await assert.rejects(
          client.conversation.create({
            data: { tenantId: ta.id, contactId: ca2.id },
          }),
        );
        await assert.rejects(
          client.conversation.update({
            where: { id: other.id },
            data: { activePatientId: pb.id },
          }),
        );
        await assert.rejects(
          client.conversation.update({
            where: { id: other.id },
            data: { status: 'HUMAN_ACTIVE', assignedUserId: users[1]!.id },
          }),
        );
      },
    );
    await t.test(
      'falha de auditoria desfaz mensagem/lastMessageAt; contexto revogado ou ausente bloqueia',
      async () => {
        const last = (
          await client.conversation.findUniqueOrThrow({
            where: { id: other.id },
          })
        ).lastMessageAt;
        const before = await client.message.count({
          where: { tenantId: ta.id, conversationId: other.id },
        });
        const failing = {
          client: {
            $transaction: (
              fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
              options: { isolationLevel: 'Serializable' },
            ) =>
              client.$transaction(
                (tx) =>
                  fn(
                    new Proxy(tx, {
                      get(target, key) {
                        if (key === 'authEvent')
                          return {
                            create: async () => {
                              throw new Error('Audit unavailable');
                            },
                          };
                        return Reflect.get(target, key);
                      },
                    }),
                  ),
                options,
              ),
          },
        } as unknown as DatabaseService;
        const failingService = new ConversationsService(
          new ConversationRepository(failing, internal.auth),
          internal.auth,
        );
        await assert.rejects(
          failingService.reply(other.id, {
            messageType: 'TEXT',
            content: 'Rollback',
          }),
        );
        assert.equal(
          await client.message.count({
            where: { tenantId: ta.id, conversationId: other.id },
          }),
          before,
        );
        assert.deepEqual(
          (
            await client.conversation.findUniqueOrThrow({
              where: { id: other.id },
            })
          ).lastMessageAt,
          last,
        );
        const original = internal.auth.requirePermissions.bind(internal.auth);
        internal.auth.requirePermissions = async (...permissions) => {
          const scope = await original(...permissions);
          await client.userTenant.update({
            where: {
              userId_tenantId: { userId: users[0]!.id, tenantId: ta.id },
            },
            data: { active: false },
          });
          return scope;
        };
        try {
          await assert.rejects(
            internal.repo.getOrCreate({
              contactId: ca.id,
              channel: 'WHATSAPP',
            }),
            ForbiddenException,
          );
        } finally {
          await client.userTenant.update({
            where: {
              userId_tenantId: { userId: users[0]!.id, tenantId: ta.id },
            },
            data: { active: true },
          });
          internal.auth.requirePermissions = original;
        }
        const empty = new AuthorizationService(
          internal.database,
          new TenantContext({} as AuthRequest, internal.database),
        );
        const repo = new ConversationRepository(internal.database, empty);
        await assert.rejects(repo.find(other.id));
        await assert.rejects(
          new ConversationsService(repo, empty).reply(other.id, {
            messageType: 'TEXT',
            content: 'x',
          }),
        );
        const events = await client.authEvent.findMany({
          where: { tenantId: ta.id, type: 'MESSAGE_CREATED' },
        });
        assert.ok(
          events.every(
            (x) =>
              !JSON.stringify(x.changes).includes('content') &&
              !JSON.stringify(x.changes).includes('metadata'),
          ),
        );
      },
    );
  } finally {
    await app.close();
    await app2.close();
    await client.$disconnect();
  }
});
