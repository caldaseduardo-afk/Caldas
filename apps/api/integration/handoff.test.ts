import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createDatabaseClient, type Prisma } from '@atendente/database';
import { createApplication } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { tokenHash } from '../src/auth/auth.service';
import type { AuthRequest } from '../src/auth/auth.guard';
import type { DatabaseService } from '../src/auth/database.service';
import { TenantContext } from '../src/tenancy/tenant.context';
import { AuthorizationService } from '../src/permissions/authorization.service';
import { ConversationRepository } from '../src/conversations/conversation.repository';
import { ConversationsService } from '../src/conversations/conversations.service';
import {
  RealtimeEvents,
  type RealtimeEvent,
} from '../src/realtime/realtime.events';
const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).pathname !== '/task002_test' ||
  connection !== process.env.DATABASE_URL
)
  throw new Error('Use pnpm db:test.');
test('Handoff: concorrência real, ownership, auditoria, fila e isolamento', async (t) => {
  const client = createDatabaseClient(connection),
    app = await createApplication(),
    app2 = await createApplication();
  try {
    await app.listen(0, '127.0.0.1');
    await app2.listen(0, '127.0.0.1');
    const urls = [await app.getUrl(), await app2.getUrl()];
    const ta = await client.tenant.create({
      data: { name: 'Handoff A', status: 'ACTIVE', timezone: 'UTC' },
    });
    const tb = await client.tenant.create({
      data: { name: 'Handoff B', status: 'ACTIVE', timezone: 'UTC' },
    });
    const password = 'senha teste handoff segura',
      passwordHash = await hashPassword(password);
    const users: { id: string; email: string; name: string }[] = [];
    for (const [tenantId, role] of [
      [ta.id, 'AGENT'],
      [ta.id, 'AGENT'],
      [tb.id, 'AGENT'],
      [ta.id, 'DOCTOR'],
    ] as const)
      users.push(
        await client.user.create({
          data: {
            name: `Operador ${randomUUID()}`,
            email: `${randomUUID()}@example.test`,
            passwordHash,
            memberships: { create: { tenantId, role } },
          },
        }),
      );
    const request = (
      path: string,
      actor = 0,
      body?: unknown,
      server = 0,
      method = body === undefined ? 'GET' : 'POST',
    ) =>
      fetch(urls[server] + path, {
        method,
        headers: {
          Cookie: cookies[actor] ?? '',
          Origin: process.env.AUTH_ORIGIN!,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const cookies: string[] = [];
    await client.authThrottle.deleteMany();
    for (const [i, user] of users.entries()) {
      const login = await fetch(urls[0] + '/auth/login', {
        method: 'POST',
        headers: {
          Origin: process.env.AUTH_ORIGIN!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: user.email, password }),
      });
      assert.equal(login.status, 200);
      cookies.push(login.headers.get('set-cookie')!.split(';')[0]!);
      assert.equal(
        (
          await request('/tenancy/active', i, {
            tenantId: i === 2 ? tb.id : ta.id,
          })
        ).status,
        200,
      );
    }
    const make = async (actor = 0) => {
      const contact = await client.contact.create({
        data: {
          tenantId: actor === 2 ? tb.id : ta.id,
          displayName: 'Contato handoff',
        },
      });
      const r = await request('/conversations', actor, {
        contactId: contact.id,
      });
      assert.equal(r.status, 200);
      return ((await r.json()) as { id: string }).id;
    };
    const op = (
      id: string,
      action: string,
      actor = 0,
      body: unknown = {},
      server = 0,
    ) => request(`/conversations/${id}/${action}`, actor, body, server);
    const queue = async (id: string, actor = 0) => {
      assert.equal(
        (
          await op(id, 'request-human', actor, {
            reason: 'USER_REQUESTED_HUMAN',
          })
        ).status,
        200,
      );
    };
    const row = (id: string) =>
      client.conversation.findUniqueOrThrow({ where: { id } });
    const bus = app.get(RealtimeEvents),
      events: RealtimeEvent[] = [];
    bus.subscribe((event) => {
      events.push(event);
    });
    app2.get(RealtimeEvents).subscribe((event) => {
      events.push(event);
    });
    const id = await make(),
      foreign = await make(2);
    const session = await client.authSession.findUniqueOrThrow({
      where: { tokenHash: tokenHash(cookies[0]!.split('=')[1]!) },
    });
    const database = { client } as DatabaseService;
    const scope = new TenantContext(
      {
        identity: users[0],
        sessionId: session.id,
        activeTenantId: ta.id,
      } as unknown as AuthRequest,
      database,
    );
    const auth = new AuthorizationService(database, scope);
    const service = new ConversationsService(
      new ConversationRepository(database, auth, bus),
      auth,
    );
    let winner = 0,
      loser = 1;
    await t.test(
      'AI permite persistência; USER fora de HUMAN é recusado; request grava razão/data sem expor tenant',
      async () => {
        await service.persistAssistant(id, {
          messageType: 'TEXT',
          content: 'Preparada',
        });
        assert.equal(
          (
            await op(id, 'messages', 0, {
              messageType: 'TEXT',
              content: 'Incorreta',
            })
          ).status,
          403,
        );
        await queue(id);
        const c = await row(id);
        assert.equal(c.status, 'NEEDS_HUMAN');
        assert.equal(c.handoffReason, 'USER_REQUESTED_HUMAN');
        assert(c.handoffRequestedAt);
        assert.equal(c.assignedUserId, null);
        assert.equal(
          (await op(id, 'request-human', 0, { reason: 'OTHER' })).status,
          409,
        );
        assert.equal(
          (await op(id, 'status', 0, { status: 'HUMAN_ACTIVE' })).status,
          400,
        );
      },
    );
    await t.test(
      'duas instâncias e dois atores disputam claim: exatamente 200/409 e uma auditoria',
      async () => {
        const before = events.length;
        const responses = await Promise.all([
          op(id, 'claim', 0, {}, 0),
          op(id, 'claim', 1, {}, 1),
        ]);
        assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
        winner = responses[0]!.status === 200 ? 0 : 1;
        loser = 1 - winner;
        const c = await row(id);
        assert.equal(c.status, 'HUMAN_ACTIVE');
        assert.equal(c.assignedUserId, users[winner]!.id);
        assert(c.assignedAt);
        assert.equal(c.handoffReason, null);
        const audits = await client.authEvent.findMany({
          where: { resourceId: id, type: 'CONVERSATION_CLAIMED' },
        });
        assert.equal(audits.length, 1);
        assert.equal(audits[0]!.userId, users[winner]!.id);
        assert.equal(audits[0]!.actorType,'USER');
        assert.equal(audits[0]!.source,'WEB');
        assert.equal(audits[0]!.resourceType,'CONVERSATION');
        assert.equal(
          events.slice(before).filter((e) => e.type === 'conversation.assigned')
            .length,
          1,
        );
        assert.equal(
          events
            .slice(before)
            .filter((e) => e.type === 'conversation.status_changed').length,
          1,
        );
        const snapshot = await row(id),
          count = events.length;
        assert.equal((await op(id, 'claim', winner)).status, 409);
        assert.deepEqual(await row(id), snapshot);
        assert.equal(events.length, count);
      },
    );
    await t.test(
      'somente responsável responde; IA suspensa; ator inativo falha fechado',
      async () => {
        await assert.rejects(
          service.persistAssistant(id, {
            messageType: 'TEXT',
            content: 'Bloqueada',
          }),
        );
        assert.equal(
          (
            await op(id, 'messages', winner, {
              messageType: 'TEXT',
              content: 'Resposta humana',
            })
          ).status,
          201,
        );
        assert.equal(
          (
            await op(id, 'messages', loser, {
              messageType: 'TEXT',
              content: 'Invasão',
            })
          ).status,
          403,
        );
        assert.equal((await op(id, 'return-to-ai', loser)).status, 403);
        assert.equal((await op(id, 'resolve', loser)).status, 403);
        await client.user.update({
          where: { id: users[winner]!.id },
          data: { status: 'DISABLED' },
        });
        try {
          assert.equal(
            (
              await op(id, 'messages', winner, {
                messageType: 'TEXT',
                content: 'Bloqueada',
              })
            ).status,
            401,
          );
          assert.equal((await op(id, 'claim', winner)).status, 401);
        } finally {
          await client.user.update({
            where: { id: users[winner]!.id },
            data: { status: 'ACTIVE' },
          });
        }
      },
    );
    await t.test(
      'operações e consultas por ID externo retornam 404; corpo não forja ator',
      async () => {
        for (const action of [
          'claim',
          'transfer',
          'return-to-ai',
          'resolve',
          'request-human',
          'messages',
        ]) {
          const body =
            action === 'transfer'
              ? { targetUserId: users[0]!.id }
              : action === 'request-human'
                ? { reason: 'OTHER' }
                : action === 'messages'
                  ? { messageType: 'TEXT', content: 'x' }
                  : {};
          const r = await op(foreign, action, 0, body);
          assert.equal(r.status, 404, action);
          assert(!JSON.stringify(await r.json()).includes('Contato handoff'));
        }
        for (const body of [
          { actor_user_id: users[1]!.id },
          { assignedUserId: users[2]!.id },
          { tenantId: tb.id },
        ])
          assert.equal((await op(id, 'claim', 0, body)).status, 400);
      },
    );
    await t.test(
      'transferência valida alvo e membership; retry não duplica; antigo dono perde resposta',
      async () => {
        for (const targetUserId of [randomUUID(), users[2]!.id, users[3]!.id])
          assert.equal(
            (await op(id, 'transfer', winner, { targetUserId })).status,
            404,
          );
        await client.user.update({
          where: { id: users[loser]!.id },
          data: { status: 'DISABLED' },
        });
        try {
          assert.equal(
            (
              await op(id, 'transfer', winner, {
                targetUserId: users[loser]!.id,
              })
            ).status,
            404,
          );
        } finally {
          await client.user.update({
            where: { id: users[loser]!.id },
            data: { status: 'ACTIVE' },
          });
        }
        await client.userTenant.update({
          where: {
            userId_tenantId: { userId: users[loser]!.id, tenantId: ta.id },
          },
          data: { active: false },
        });
        try {
          assert.equal(
            (
              await op(id, 'transfer', winner, {
                targetUserId: users[loser]!.id,
              })
            ).status,
            404,
          );
        } finally {
          await client.userTenant.update({
            where: {
              userId_tenantId: { userId: users[loser]!.id, tenantId: ta.id },
            },
            data: { active: true },
          });
        }
        const before = events.length;
        assert.equal(
          (await op(id, 'transfer', winner, { targetUserId: users[loser]!.id }))
            .status,
          200,
        );
        const c = await row(id);
        assert.equal(c.status, 'HUMAN_ACTIVE');
        assert.equal(c.assignedUserId, users[loser]!.id);
        assert.equal(
          (await op(id, 'transfer', winner, { targetUserId: users[loser]!.id }))
            .status,
          409,
        );
        assert.deepEqual(await row(id), c);
        const audit = await client.authEvent.findFirstOrThrow({
          where: { resourceId: id, type: 'CONVERSATION_TRANSFERRED' },
        });
        assert.equal(audit.userId, users[winner]!.id);
        assert.equal(
          (audit.changes as Prisma.JsonObject).previousAssignee,
          users[winner]!.id,
        );
        assert(
          events.slice(before).some((e) => e.type === 'conversation.assigned'),
        );
        assert.equal(
          (
            await op(id, 'messages', winner, {
              messageType: 'TEXT',
              content: 'antigo',
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await op(id, 'messages', loser, {
              messageType: 'TEXT',
              content: 'novo',
            })
          ).status,
          201,
        );
      },
    );
    await t.test(
      'revogação de assign/transfer/close/reply tem efeito sem novo login',
      async () => {
        const waiting = await make();
        await queue(waiting);
        for (const [permissionName, action, resource, actor] of [
          ['conversation.assign', 'claim', waiting, 0],
          ['conversation.transfer', 'transfer', id, loser],
          ['conversation.transfer', 'return-to-ai', id, loser],
          ['conversation.close', 'resolve', id, loser],
          ['conversation.reply', 'messages', id, loser],
        ] as const) {
          await client.rolePermission.delete({
            where: {
              roleName_permissionName: { roleName: 'AGENT', permissionName },
            },
          });
          try {
            assert.equal(
              (
                await op(
                  resource,
                  action,
                  actor,
                  action === 'transfer'
                    ? { targetUserId: users[winner]!.id }
                    : action === 'messages'
                      ? { messageType: 'TEXT', content: 'x' }
                      : {},
                )
              ).status,
              403,
            );
          } finally {
            await client.rolePermission.create({
              data: { roleName: 'AGENT', permissionName },
            });
          }
        }
      },
    );
    await t.test(
      'retorno limpa lock, habilita IA; resolução guarda data, limpa responsável e não reabre',
      async () => {
        const before = events.length;
        assert.equal((await op(id, 'return-to-ai', loser)).status, 200);
        const c = await row(id);
        assert.equal(c.status, 'AI_ACTIVE');
        assert.equal(c.assignedUserId, null);
        assert.equal(c.assignedAt, null);
        assert.equal(c.handoffRequestedAt, null);
        await service.persistAssistant(id, {
          messageType: 'TEXT',
          content: 'Retomada estrutural',
        });
        assert(
          events
            .slice(before)
            .some((e) => e.type === 'conversation.status_changed'),
        );
        await queue(id);
        assert.equal((await op(id, 'claim')).status, 200);
        assert.equal((await op(id, 'resolve')).status, 200);
        assert.equal((await row(id)).status, 'RESOLVED');
        assert((await row(id)).resolvedAt);
        assert.equal((await row(id)).assignedUserId, null);
        assert.equal((await op(id, 'claim')).status, 409);
        assert.equal(
          (await op(id, 'status', 0, { status: 'CLOSED' })).status,
          200,
        );
        assert.equal((await op(id, 'claim')).status, 409);
        for (const type of [
          'HUMAN_HANDOFF_REQUESTED',
          'CONVERSATION_RETURNED_TO_AI',
          'CONVERSATION_RESOLVED',
        ] as const)
          assert(
            await client.authEvent.findFirst({
              where: { resourceId: id, type, tenantId: ta.id },
            }),
          );
      },
    );
    await t.test(
      'fila FIFO, filtros, paginação, projeção e alvos permanecem no tenant',
      async () => {
        const x = await make(),
          y = await make();
        await queue(x);
        await queue(y);
        await queue(foreign, 2);
        const r = await request(
          '/inbox/conversations?status=NEEDS_HUMAN&limit=100',
        );
        assert.equal(r.status, 200);
        const list = (await r.json()) as {
          items: {
            id: string;
            handoffRequestedAt: string;
            assignedUserId: string | null;
          }[];
        };
        assert(
          list.items.findIndex((c) => c.id === x) <
            list.items.findIndex((c) => c.id === y),
        );
        assert(!list.items.some((c) => c.id === foreign));
        assert(
          list.items.every(
            (c) => c.handoffRequestedAt && c.assignedUserId === null,
          ),
        );
        const first = (await (
          await request('/inbox/conversations?status=NEEDS_HUMAN&limit=1')
        ).json()) as { items: unknown[]; hasMore: boolean };
        assert.equal(first.items.length, 1);
        assert(first.hasMore);
        const targets = (await (
          await request('/inbox/assignees?limit=100')
        ).json()) as { items: { id: string; name: string }[] };
        assert.deepEqual(
          targets.items.map((u) => u.id).sort(),
          users
            .slice(0, 2)
            .map((u) => u.id)
            .sort(),
        );
        assert(!JSON.stringify(targets).includes('email'));
        assert(!JSON.stringify(list).includes('tenantId'));
        assert.equal(
          (await op(x, 'status', 0, { status: 'AI_ACTIVE' })).status,
          409,
        );
      },
    );
    await t.test(
      'WAITING_PATIENT solicita humano; SQL impede estados inconsistentes',
      async () => {
        const waiting = await make();
        assert.equal(
          (await op(waiting, 'status', 0, { status: 'WAITING_PATIENT' }))
            .status,
          200,
        );
        await queue(waiting);
        for (const data of [
          { status: 'HUMAN_ACTIVE' as const },
          { status: 'AI_ACTIVE' as const, assignedUserId: users[0]!.id },
          { status: 'NEEDS_HUMAN' as const, handoffReason: null },
        ])
          await assert.rejects(
            client.conversation.update({ where: { id: waiting }, data }),
          );
        assert.equal((await op(waiting, 'claim')).status, 200);
        assert.equal(
          (await op(waiting, 'status', 0, { status: 'WAITING_PATIENT' }))
            .status,
          409,
        );
      },
    );
    await t.test(
      'rollback de auditoria não publica handoff; envelopes não carregam dados pessoais',
      async () => {
        const resource = await make(),
          before = events.length;
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
                              throw new Error('audit unavailable');
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
        const broken = new ConversationsService(
          new ConversationRepository(failing, auth, bus),
          auth,
        );
        await assert.rejects(
          broken.handoff(resource, 'request-human', { reason: 'OTHER' }),
        );
        assert.equal((await row(resource)).status, 'AI_ACTIVE');
        assert.equal(events.length, before);
        for (const e of events)
          assert(
            Object.keys(e).every((key) =>
              [
                'eventId',
                'type',
                'tenantId',
                'conversationId',
                'messageId',
              ].includes(key),
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
