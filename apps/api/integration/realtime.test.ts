import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { WebSocket } from 'ws';
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
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).pathname !== '/task002_test' ||
  connection !== process.env.DATABASE_URL
)
  throw new Error('Use pnpm db:test.');
async function until(check: () => boolean) {
  const end = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > end) throw new Error('Evento esperado não recebido.');
    await delay(10);
  }
}
test('WebSocket real: commit, isolamento, sessão, RBAC, recibos e cleanup', async (t) => {
  const client = createDatabaseClient(connection),
    app = await createApplication(),
    sockets: WebSocket[] = [];
  try {
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl(),
      wsUrl = url.replace('http:', 'ws:') + '/realtime';
    const bus = app.get(RealtimeEvents),
      gateway = app.get(RealtimeGateway);
    const request = (
      path: string,
      cookie = '',
      method = 'GET',
      body?: unknown,
    ) =>
      fetch(url + path, {
        method,
        headers: {
          Cookie: cookie,
          Origin: process.env.AUTH_ORIGIN!,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const ta = await client.tenant.create({
        data: { name: 'Realtime A', status: 'ACTIVE', timezone: 'UTC' },
      }),
      tb = await client.tenant.create({
        data: { name: 'Realtime B', status: 'ACTIVE', timezone: 'UTC' },
      });
    const password = 'senha realtime longa teste',
      passwordHash = await hashPassword(password);
    await client.authThrottle.deleteMany();
    async function login(tenantId: string, role: 'AGENT' | 'DOCTOR') {
      const user = await client.user.create({
        data: {
          name: role,
          email: `${randomUUID()}@realtime.test`,
          passwordHash,
          memberships: { create: { tenantId, role } },
        },
      });
      const r = await request('/auth/login', '', 'POST', {
        email: user.email,
        password,
      });
      assert.equal(r.status, 200);
      const cookie = r.headers.get('set-cookie')!.split(';')[0]!;
      assert.equal(
        (await request('/tenancy/active', cookie, 'POST', { tenantId })).status,
        200,
      );
      const session = await client.authSession.findUniqueOrThrow({
        where: { tokenHash: tokenHash(cookie.split('=')[1]!) },
      });
      return { cookie, user, session };
    }
    const a = await login(ta.id, 'AGENT'),
      b = await login(tb.id, 'AGENT'),
      doctor = await login(ta.id, 'DOCTOR');
    async function open(cookie: string, autoPong = true) {
      const socket = new WebSocket(wsUrl, {
        autoPong,
        headers: { Cookie: cookie, Origin: process.env.AUTH_ORIGIN! },
      });
      sockets.push(socket);
      const events: RealtimeEvent[] = [];
      let ready = false;
      socket.on('message', (raw) => {
        const e = JSON.parse(raw.toString());
        if (e.type === 'realtime.ready') ready = true;
        else events.push(e);
      });
      socket.on('error', () => {});
      await until(() => ready);
      return { socket, events };
    }
    async function rejected(
      cookie: string,
      suffix = '',
      origin = process.env.AUTH_ORIGIN!,
    ) {
      const socket = new WebSocket(wsUrl + suffix, {
        headers: { Cookie: cookie, Origin: origin },
      });
      sockets.push(socket);
      const result = await new Promise<number>((resolve, reject) => {
        socket.once('open', () =>
          reject(new Error('Conexão deveria ser rejeitada.')),
        );
        socket.once('unexpected-response', (_req, response) => {
          response.resume();
          socket.terminate();
          resolve(response.statusCode!);
        });
        socket.on('error', () => {});
      });
      assert.equal(result, 403);
    }
    const sa = await open(a.cookie),
      sa2 = await open(a.cookie),
      sb = await open(b.cookie);
    await t.test(
      'autenticado conecta; anônimo, cookie inválido, Origin e RBAC são rejeitados',
      async () => {
        assert.equal(sa.socket.readyState, WebSocket.OPEN);
        await rejected('');
        await rejected('atendente_session=invalid');
        await rejected(a.cookie, '', 'https://evil.test');
        await rejected(doctor.cookie);
      },
    );
    const ca = await client.contact.create({
        data: { tenantId: ta.id, displayName: 'A' },
      }),
      cb = await client.contact.create({
        data: { tenantId: tb.id, displayName: 'B' },
      });
    const create = async (cookie: string, contactId: string) => {
      const r = await request('/conversations', cookie, 'POST', { contactId });
      assert.equal(r.status, 200);
      return (await r.json()) as { id: string };
    };
    const convA = await create(a.cookie, ca.id),
      convB = await create(b.cookie, cb.id);
    await t.test(
      'created entrega às duas janelas A; nenhum vazamento A/B',
      async () => {
        await until(
          () =>
            sa.events.some((e) => e.conversationId === convA.id) &&
            sa2.events.some((e) => e.conversationId === convA.id) &&
            sb.events.some((e) => e.conversationId === convB.id),
        );
        assert(sa.events.every((e) => e.tenantId === ta.id));
        assert(sb.events.every((e) => e.tenantId === tb.id));
      },
    );
    const database = { client } as DatabaseService;
    const auth = new AuthorizationService(
      database,
      new TenantContext(
        {
          identity: a.user,
          sessionId: a.session.id,
          activeTenantId: ta.id,
        } as unknown as AuthRequest,
        database,
      ),
    );
    const repo = new ConversationRepository(database, auth, bus),
      service = new ConversationsService(repo, auth);
    const latest = async (type: RealtimeEvent['type'], before: number) => {
      await until(() => sa.events.slice(before).some((e) => e.type === type));
      return sa.events.slice(before).find((e) => e.type === type)!;
    };
    const messageIds: string[] = [];
    for (const sender of ['USER', 'PATIENT', 'AI', 'SYSTEM'] as const)
      await t.test(
        `${sender}: message.created somente após commit, lastMessageAt e payload mínimo`,
        async () => {
          if (sender === 'USER') {
            await service.handoff(convA.id, 'request-human', {
              reason: 'OTHER',
            });
            await service.handoff(convA.id, 'claim', {});
          }
          if (sender === 'AI')
            await service.handoff(convA.id, 'return-to-ai', {});
          const before = sa.events.length;
          const message = await repo.persist(
            convA.id,
            {
              messageType: 'TEXT',
              content: '<script>segredo clínico</script>',
              ...(sender === 'PATIENT'
                ? { providerMessageId: 'external-1' }
                : {}),
            },
            sender,
          );
          messageIds.push(message.id);
          const e = await latest('message.created', before);
          assert.equal(e.messageId, message.id);
          assert(
            await client.message.findUnique({ where: { id: e.messageId } }),
          );
          const conversation = await client.conversation.findUniqueOrThrow({
            where: { id: convA.id },
          });
          assert.equal(+conversation.lastMessageAt!, +message.createdAt);
          assert.deepEqual(Object.keys(e).sort(), [
            'conversationId',
            'eventId',
            'messageId',
            'tenantId',
            'type',
          ]);
          assert(!JSON.stringify(e).includes('segredo'));
          assert.equal(sb.events.filter((e) => e.tenantId === ta.id).length, 0);
        },
      );
    await t.test(
      'retry idempotente não republica mensagem; IDs únicos por evento',
      async () => {
        const before = sa.events.length;
        await service.persistIncoming(convA.id, {
          providerMessageId: 'external-1',
          messageType: 'TEXT',
          content: '<script>segredo clínico</script>',
        });
        await delay(80);
        assert.equal(sa.events.length, before);
        assert.equal(
          new Set(sa.events.map((e) => e.eventId)).size,
          sa.events.length,
        );
      },
    );
    await t.test(
      'falha de auditoria desfaz mensagem sem evento fantasma',
      async () => {
        const before = sa.events.length,
          count = await client.message.count({
            where: { conversationId: convA.id },
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
        await assert.rejects(
          new ConversationRepository(failing, auth, bus).persist(
            convA.id,
            { messageType: 'TEXT', content: 'rollback' },
            'USER',
          ),
        );
        assert.equal(
          await client.message.count({ where: { conversationId: convA.id } }),
          count,
        );
        await delay(80);
        assert.equal(sa.events.length, before);
      },
    );
    await t.test(
      'updated e active_patient_changed propagam sem dados de paciente',
      async () => {
        const patient = await client.patient.create({
          data: {
            tenantId: ta.id,
            name: 'Nome sensível',
            birthDate: new Date('2000-01-01'),
          },
        });
        await client.contactPatient.create({
          data: {
            tenantId: ta.id,
            contactId: ca.id,
            patientId: patient.id,
            relationshipType: 'SELF',
            relationshipStatus: 'VERIFIED',
            authorizationLevel: 'FULL',
            authorizedBy: a.user.id,
            authorizedAt: new Date(),
          },
        });
        const before = sa.events.length;
        await service.update(convA.id, {
          activePatientId: patient.id,
          intent: 'SCHEDULING',
        });
        await latest('conversation.updated', before);
        const e = await latest('conversation.active_patient_changed', before);
        assert(!JSON.stringify(e).includes(patient.id));
      },
    );
    await t.test('status e claim propagam pelo mesmo barramento', async () => {
      let before = sa.events.length;
      await service.handoff(convA.id, 'request-human', { reason: 'OTHER' });
      await latest('conversation.status_changed', before);
      before = sa.events.length;
      await service.handoff(convA.id, 'claim', {});
      await latest('conversation.assigned', before);
    });
    await t.test(
      'transferência e retorno à IA chegam por WebSocket após persistência sem vazar tenant',
      async () => {
        await client.userTenant.create({
          data: { tenantId: ta.id, userId: b.user.id, role: 'AGENT' },
        });
        let before = sa.events.length;
        await service.handoff(convA.id, 'transfer', {
          targetUserId: b.user.id,
        });
        await latest('conversation.assigned', before);
        assert.equal(
          (
            await client.conversation.findUniqueOrThrow({
              where: { id: convA.id },
            })
          ).assignedUserId,
          b.user.id,
        );
        before = sa.events.length;
        await service.handoff(convA.id, 'transfer', {
          targetUserId: a.user.id,
        });
        await latest('conversation.assigned', before);
        before = sa.events.length;
        await service.handoff(convA.id, 'return-to-ai', {});
        await latest('conversation.status_changed', before);
        assert.equal(
          (
            await client.conversation.findUniqueOrThrow({
              where: { id: convA.id },
            })
          ).status,
          'AI_ACTIVE',
        );
        assert.equal(sb.events.filter((e) => e.tenantId === ta.id).length, 0);
        await service.handoff(convA.id, 'request-human', { reason: 'OTHER' });
        await service.handoff(convA.id, 'claim', {});
      },
    );
    await t.test(
      'recibos internos publicam delivered/read; repetição não gera evento',
      async () => {
        const at = new Date().toISOString();
        let before = sa.events.length;
        await service.recordReceipt(convA.id, messageIds[0]!, {
          kind: 'DELIVERED',
          at,
        });
        await latest('message.delivered', before);
        before = sa.events.length;
        await service.recordReceipt(convA.id, messageIds[0]!, {
          kind: 'READ',
          at,
        });
        await latest('message.read', before);
        before = sa.events.length;
        await service.recordReceipt(convA.id, messageIds[0]!, {
          kind: 'READ',
          at,
        });
        await delay(80);
        assert.equal(sa.events.length, before);
      },
    );
    await t.test(
      'IDs estrangeiros no evento interno são filtrados; query/subscription não autoriza',
      async () => {
        const before = sa.events.length;
        bus.publish({
          type: 'conversation.updated',
          tenantId: ta.id,
          conversationId: convB.id,
        });
        bus.publish({
          type: 'message.created',
          tenantId: ta.id,
          conversationId: convA.id,
          messageId: (
            await client.message.create({
              data: {
                tenantId: tb.id,
                conversationId: convB.id,
                channel: 'WHATSAPP',
                senderType: 'SYSTEM',
                messageType: 'TEXT',
                content: 'Só tenant B',
              },
            })
          ).id,
        });
        await delay(100);
        assert.equal(sa.events.length, before);
        await rejected(
          a.cookie,
          `?tenantId=${tb.id}&conversationId=${convB.id}`,
        );
        const forbidden = await open(a.cookie);
        forbidden.socket.send(JSON.stringify({ subscribe: convB.id }));
        await until(() => forbidden.socket.readyState === WebSocket.CLOSED);
      },
    );
    await t.test(
      'heartbeat ping/pong conserva conexões saudáveis',
      async () => {
        await gateway.heartbeat();
        await delay(30);
        await gateway.heartbeat();
        assert.equal(sa.socket.readyState, WebSocket.OPEN);
      },
    );
    await t.test(
      'proxy Next encaminha upgrade, cookie HttpOnly e Origin real',
      async () => {
        const web = resolve(process.cwd(), '../web');
        const child = spawn(
          process.execPath,
          [
            resolve(web, 'node_modules/next/dist/bin/next'),
            'dev',
            '--hostname',
            '127.0.0.1',
            '--port',
            '3199',
          ],
          {
            cwd: web,
            env: { ...process.env, API_INTERNAL_URL: url },
            stdio: 'ignore',
          },
        );
        try {
          let ready = false;
          for (let i = 0; i < 100; i++) {
            if (child.exitCode !== null)
              throw new Error('Next de teste encerrou.');
            try {
              const response = await fetch(
                'http://127.0.0.1:3199/conversations',
              );
              if (response.ok) {
                ready = true;
                break;
              }
            } catch {
              /* starting */
            }
            await delay(100);
          }
          assert(ready);
          const proxied = new WebSocket('ws://127.0.0.1:3199/realtime', {
            headers: { Cookie: a.cookie, Origin: process.env.AUTH_ORIGIN! },
          });
          sockets.push(proxied);
          let acknowledged = false;
          proxied.on('error', () => {});
          proxied.on('message', (data) => {
            const e = JSON.parse(data.toString());
            if (e.type === 'realtime.ready' && e.tenantId === ta.id)
              acknowledged = true;
          });
          await until(() => acknowledged);
          proxied.close();
        } finally {
          child.kill('SIGTERM');
          await new Promise<void>((resolve) => {
            if (child.exitCode !== null) resolve();
            else child.once('exit', () => resolve());
          });
        }
      },
    );
    await t.test(
      'heartbeat encerra cliente que não responde pong',
      async () => {
        const dead = await open(a.cookie, false);
        await gateway.heartbeat();
        await delay(80);
        await gateway.heartbeat();
        await until(() => dead.socket.readyState === WebSocket.CLOSED);
      },
    );
    await t.test(
      'revogação de permissão bloqueia entrega em conexão existente e reconexão',
      async () => {
        await client.rolePermission.delete({
          where: {
            roleName_permissionName: {
              roleName: 'AGENT',
              permissionName: 'conversation.view',
            },
          },
        });
        try {
          const before = sa.events.length;
          bus.publish({
            type: 'conversation.updated',
            tenantId: ta.id,
            conversationId: convA.id,
          });
          await until(() => sa.socket.readyState === WebSocket.CLOSED);
          assert.equal(sa.events.length, before);
          await rejected(a.cookie);
        } finally {
          await client.rolePermission.create({
            data: { roleName: 'AGENT', permissionName: 'conversation.view' },
          });
        }
      },
    );
    await t.test(
      'troca de tenant encerra conexões antigas da sessão; nova sala B',
      async () => {
        const old = await open(a.cookie);
        await client.userTenant.create({
          data: { userId: a.user.id, tenantId: tb.id, role: 'AGENT' },
        });
        assert.equal(
          (
            await request('/tenancy/active', a.cookie, 'POST', {
              tenantId: tb.id,
            })
          ).status,
          200,
        );
        await until(() => old.socket.readyState === WebSocket.CLOSED);
        const changed = await open(a.cookie);
        bus.publish({
          type: 'conversation.updated',
          tenantId: ta.id,
          conversationId: convA.id,
        });
        bus.publish({
          type: 'conversation.updated',
          tenantId: tb.id,
          conversationId: convB.id,
        });
        await until(() => changed.events.length > 0);
        assert(changed.events.every((e) => e.tenantId === tb.id));
      },
    );
    await t.test(
      'logout fecha socket e impede reconexão da sessão invalidada',
      async () => {
        const current = await open(a.cookie);
        assert.equal(
          (await request('/auth/logout', a.cookie, 'POST')).status,
          204,
        );
        await until(() => current.socket.readyState === WebSocket.CLOSED);
        await rejected(a.cookie);
      },
    );
    await t.test(
      'usuário inativo rejeitado e heartbeat encerra sessão existente',
      async () => {
        const current = await open(b.cookie);
        await client.user.update({
          where: { id: b.user.id },
          data: { status: 'DISABLED' },
        });
        await rejected(b.cookie);
        await gateway.heartbeat();
        await until(() => current.socket.readyState === WebSocket.CLOSED);
      },
    );
    await t.test(
      'tenant ausente/inativo e sessão expirada rejeitam handshake de AGENT ativo',
      async () => {
        await client.user.update({
          where: { id: b.user.id },
          data: { status: 'ACTIVE' },
        });
        await client.authSession.update({
          where: { id: b.session.id },
          data: { activeTenantId: null },
        });
        await rejected(b.cookie);
        await client.authSession.update({
          where: { id: b.session.id },
          data: { activeTenantId: tb.id },
        });
        await client.tenant.update({
          where: { id: tb.id },
          data: { status: 'INACTIVE' },
        });
        await rejected(b.cookie);
        await client.tenant.update({
          where: { id: tb.id },
          data: { status: 'ACTIVE' },
        });
        await client.authSession.update({
          where: { id: b.session.id },
          data: { expiresAt: new Date(0) },
        });
        await rejected(b.cookie);
      },
    );
  } finally {
    for (const socket of sockets) socket.terminate();
    await app.close();
    await client.$disconnect();
  }
});
