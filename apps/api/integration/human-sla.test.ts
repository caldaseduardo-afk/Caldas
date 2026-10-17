import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import {
  createDatabaseClient,
  databaseNow,
  processHumanSlaJob,
  startHumanSlaCycle,
  createHumanSlaQueue,
  dispatchHumanSlaJobs,
  createHumanSlaWorker,
} from '@atendente/database';
import { createApplication } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
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
const config = {
  firstAlertMinutes: 5,
  secondAlertMinutes: 10,
  externalAlertMinutes: 15,
  internalAlertEnabled: true,
  externalAlertEnabled: true,
  active: true,
};
async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 8000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Condição SLA não ocorreu.');
    await delay(25);
  }
}
test('SLA humano: tenant, tempo, ciclos, outbox, BullMQ, concorrência e WebSocket', async (t) => {
  const client = createDatabaseClient(connection),
    app = await createApplication();
  const sockets: WebSocket[] = [];
  let queue: ReturnType<typeof createHumanSlaQueue> | undefined;
  let worker: ReturnType<typeof createHumanSlaWorker> | undefined;
  try {
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const ta = await client.tenant.create({
      data: { name: 'SLA A', status: 'ACTIVE', timezone: 'UTC' },
    });
    const tb = await client.tenant.create({
      data: { name: 'SLA B', status: 'ACTIVE', timezone: 'UTC' },
    });
    const password = 'senha segura testes de SLA',
      passwordHash = await hashPassword(password);
    const cookies: string[] = [];
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
    await client.authThrottle.deleteMany();
    for (const [tenantId, role] of [
      [ta.id, 'CLINIC_ADMIN'],
      [ta.id, 'AGENT'],
      [tb.id, 'CLINIC_ADMIN'],
    ] as const) {
      const user = await client.user.create({
        data: {
          name: 'SLA operador',
          email: `${randomUUID()}@example.test`,
          passwordHash,
          memberships: { create: { tenantId, role } },
        },
      });
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
    const op = (id: string, action: string, body: unknown = {}, actor = 0) =>
      request(`/conversations/${id}/${action}`, actor, body);
    const make = async (actor = 0) => {
      const contact = await client.contact.create({
        data: {
          tenantId: actor === 2 ? tb.id : ta.id,
          displayName: 'Contato SLA',
        },
      });
      const response = await request('/conversations', actor, {
        contactId: contact.id,
      });
      assert.equal(response.status, 200);
      const { id } = (await response.json()) as { id: string };
      assert.equal(
        (await op(id, 'request-human', { reason: 'OTHER' }, actor)).status,
        200,
      );
      return id;
    };
    const get = (id: string) =>
      client.conversation.findUniqueOrThrow({ where: { id } });
    const cycleOf = (id: string) =>
      client.humanSlaCycle.findFirstOrThrow({
        where: { conversationId: id, endedAt: null },
      });
    // Advance fixture timestamps, not the production clock; thresholds remain integer minutes.
    const age = async (id: string, minutes: number) => {
      const cycle = await cycleOf(id),
        start = new Date(+(await databaseNow(client)) - minutes * 60000);
      await client.$transaction(async (tx) => {
        await tx.conversation.update({
          where: { id },
          data: { handoffRequestedAt: start },
        });
        await tx.humanSlaCycle.update({
          where: { id: cycle.id },
          data: { requestedAt: start },
        });
        const minutesByLevel = {
          FIRST: cycle.firstAlertMinutes,
          SECOND: cycle.secondAlertMinutes,
          EXTERNAL: cycle.externalAlertMinutes!,
          NONE: 0,
        };
        for (const job of await tx.humanSlaJob.findMany({
          where: { cycleId: cycle.id },
        }))
          await tx.humanSlaJob.update({
            where: { id: job.id },
            data: {
              dueAt: new Date(+start + minutesByLevel[job.level] * 60000),
              nextDispatchAt: new Date(0),
            },
          });
      });
      return cycle;
    };
    const run = async (id: string, level: 'FIRST' | 'SECOND' | 'EXTERNAL') => {
      const cycle = await cycleOf(id),
        job = await client.humanSlaJob.findFirstOrThrow({
          where: { cycleId: cycle.id, level },
        });
      return processHumanSlaJob(client, {
        tenantId: cycle.tenantId,
        jobId: job.id,
      });
    };
    let ruleA = '',
      ruleB = '';
    await t.test(
      'sem regra não bloqueia handoff; CRUD, DTO e RBAC são isolados',
      async () => {
        const noRule = await make();
        assert.equal(
          await client.humanSlaCycle.count({
            where: { conversationId: noRule },
          }),
          0,
        );
        assert.equal((await op(noRule, 'claim')).status, 200);
        assert.equal(
          (await request('/human-sla-rules', 1, config)).status,
          403,
        );
        for (const extra of [
          { firstAlertMinutes: 0 },
          { secondAlertMinutes: 5 },
          { externalAlertMinutes: 10 },
          { tenantId: tb.id },
        ])
          assert.equal(
            (await request('/human-sla-rules', 0, { ...config, ...extra }))
              .status,
            400,
          );
        const a = await request('/human-sla-rules', 0, config);
        assert.equal(a.status, 201);
        ruleA = ((await a.json()) as { id: string }).id;
        const b = await request('/human-sla-rules', 2, {
          ...config,
          firstAlertMinutes: 2,
          secondAlertMinutes: 5,
          externalAlertMinutes: 10,
        });
        assert.equal(b.status, 201);
        ruleB = ((await b.json()) as { id: string }).id;
        assert.equal((await request(`/human-sla-rules/${ruleB}`)).status, 404);
        assert.equal(
          (
            await request(
              `/human-sla-rules/${ruleB}`,
              0,
              { active: false },
              'PATCH',
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              `/human-sla-rules/${ruleA}`,
              1,
              { active: false },
              'PATCH',
            )
          ).status,
          403,
        );
        assert.equal(
          (await request('/human-sla-rules', 0, config)).status,
          409,
        );
        const preview = (await (
          await request(`/human-sla-rules/${ruleA}/preview`, 0, {
            requestedAt: '2026-10-04T14:00:00Z',
          })
        ).json()) as { alerts: { dueAt: string }[] };
        assert.deepEqual(
          preview.alerts.map((a) => a.dueAt),
          [
            '2026-10-04T14:05:00.000Z',
            '2026-10-04T14:10:00.000Z',
            '2026-10-04T14:15:00.000Z',
          ],
        );
      },
    );
    await t.test(
      'ciclo/outbox idempotentes; mensagens não reiniciam espera; execução antecipada não alerta',
      async () => {
        const id = await make(),
          cycle = await cycleOf(id);
        assert.equal(
          await client.humanSlaJob.count({ where: { cycleId: cycle.id } }),
          3,
        );
        await client.$transaction((tx) =>
          startHumanSlaCycle(tx, ta.id, id, cycle.requestedAt),
        );
        assert.equal(
          await client.humanSlaJob.count({ where: { cycleId: cycle.id } }),
          3,
        );
        await client.message.create({
          data: {
            tenantId: ta.id,
            conversationId: id,
            channel: 'WHATSAPP',
            senderType: 'PATIENT',
            messageType: 'TEXT',
            content: 'Nova mensagem',
            providerMessageId: randomUUID(),
          },
        });
        assert.equal(+(await get(id)).handoffRequestedAt!, +cycle.requestedAt);
        assert.equal(await run(id, 'FIRST'), null);
        assert.equal((await get(id)).slaLevel, 'NONE');
        const job = await client.humanSlaJob.findFirstOrThrow({
          where: { cycleId: cycle.id },
        });
        assert.equal(
          await processHumanSlaJob(client, { tenantId: tb.id, jobId: job.id }),
          null,
        );
      },
    );
    await t.test(
      'FIRST, SECOND, EXTERNAL registram uma vez, com histórico e fila corretos',
      async () => {
        const id = await make();
        for (const [minutes, level, type] of [
          [5, 'FIRST', 'HUMAN_SLA_FIRST_ALERT'],
          [10, 'SECOND', 'HUMAN_SLA_SECOND_ALERT'],
          [15, 'EXTERNAL', 'HUMAN_SLA_EXTERNAL_ALERT_REQUIRED'],
        ] as const) {
          await age(id, minutes);
          assert(await run(id, level));
          assert.equal((await get(id)).slaLevel, level);
          const count = await client.authEvent.count({
            where: { resourceId: id, type },
          });
          assert.equal(count, 1);
          assert.equal(await run(id, level), null);
          assert.equal(
            await client.authEvent.count({ where: { resourceId: id, type } }),
            1,
          );
        }
        const list = (await (
          await request('/inbox/conversations?status=NEEDS_HUMAN')
        ).json()) as { items: { id: string; slaLevel: string }[] };
        assert.equal(list.items.find((c) => c.id === id)!.slaLevel, 'EXTERNAL');
        const event = await client.authEvent.findFirstOrThrow({
          where: { resourceId: id, type: 'HUMAN_SLA_EXTERNAL_ALERT_REQUIRED' },
        });
        assert.equal(
          (event.changes as { externalSent: boolean }).externalSent,
          false,
        );
        assert(!JSON.stringify(event.changes).includes('Contato SLA'));
      },
    );
    await t.test(
      'claim antes ou entre níveis invalida todos jobs e conserva métrica; estados finais fazem SKIP',
      async () => {
        for (const minutes of [0, 5, 10]) {
          const id = await make();
          await age(id, minutes);
          if (minutes) await run(id, minutes === 5 ? 'FIRST' : 'SECOND');
          const cycle = await cycleOf(id),
            jobs = await client.humanSlaJob.findMany({
              where: { cycleId: cycle.id },
            });
          assert.equal((await op(id, 'claim')).status, 200);
          assert.equal((await get(id)).slaLevel, 'NONE');
          const closed = await client.humanSlaCycle.findUniqueOrThrow({
            where: { id: cycle.id },
          });
          assert(closed.claimedAt);
          assert(+closed.claimedAt >= +closed.requestedAt);
          for (const action of [null, 'resolve', 'status'] as const) {
            if (action)
              assert.equal(
                (
                  await op(
                    id,
                    action,
                    action === 'status' ? { status: 'CLOSED' } : {},
                  )
                ).status,
                200,
              );
            for (const job of jobs)
              assert.equal(
                await processHumanSlaJob(client, {
                  tenantId: ta.id,
                  jobId: job.id,
                }),
                null,
              );
          }
        }
      },
    );
    await t.test(
      'novo handoff tem outro UUID; jobs de ciclo antigo não afetam reentrada nem AI_ACTIVE',
      async () => {
        const id = await make(),
          old = await cycleOf(id),
          jobs = await client.humanSlaJob.findMany({
            where: { cycleId: old.id },
          });
        await op(id, 'claim');
        assert.equal((await op(id, 'return-to-ai')).status, 200);
        for (const job of jobs)
          assert.equal(
            await processHumanSlaJob(client, {
              tenantId: ta.id,
              jobId: job.id,
            }),
            null,
          );
        await op(id, 'request-human', { reason: 'OTHER' });
        const fresh = await cycleOf(id);
        assert.notEqual(fresh.id, old.id);
        for (const job of jobs)
          assert.equal(
            await processHumanSlaJob(client, {
              tenantId: ta.id,
              jobId: job.id,
            }),
            null,
          );
        assert.equal((await get(id)).slaLevel, 'NONE');
        assert.equal(
          await client.humanSlaJob.count({ where: { cycleId: fresh.id } }),
          3,
        );
      },
    );
    await t.test(
      'worker atrasado converge para maior nível sem três alertas artificiais; concorrência idempotente',
      async () => {
        const id = await make(),
          cycle = await age(id, 20);
        const jobs = await client.humanSlaJob.findMany({
          where: { cycleId: cycle.id },
        });
        const results = await Promise.all(
          jobs.flatMap((job) => [
            processHumanSlaJob(client, { tenantId: ta.id, jobId: job.id }),
            processHumanSlaJob(client, { tenantId: ta.id, jobId: job.id }),
          ]),
        );
        assert.equal(results.filter(Boolean).length, 1);
        assert.equal((await get(id)).slaLevel, 'EXTERNAL');
        assert.equal(
          await client.authEvent.count({
            where: {
              resourceId: id,
              type: {
                in: [
                  'HUMAN_SLA_FIRST_ALERT',
                  'HUMAN_SLA_SECOND_ALERT',
                  'HUMAN_SLA_EXTERNAL_ALERT_REQUIRED',
                ],
              },
            },
          }),
          1,
        );
      },
    );
    await t.test(
      'claim concorrente com alerta termina HUMAN_ACTIVE sem nível ativo ou job futuro',
      async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          const id = await make();
          const cycle = await age(id, 6);
          const [claim] = await Promise.all([
            op(id, 'claim'),
            run(id, 'FIRST'),
          ]);
          assert.equal(claim.status, 200);
          const current = await get(id);
          assert.equal(current.status, 'HUMAN_ACTIVE');
          assert.equal(current.slaLevel, 'NONE');
          assert.equal(
            await client.humanSlaJob.count({
              where: { cycleId: cycle.id, processedAt: null },
            }),
            0,
          );
          assert(
            (await client.authEvent.count({
              where: { resourceId: id, type: 'HUMAN_SLA_FIRST_ALERT' },
            })) <= 1,
          );
        }
      },
    );
    await t.test(
      'configuração A não muda snapshot/jobs de B; desativação cancela ciclos e impede novos jobs',
      async () => {
        const b = await make(2),
          bCycle = await cycleOf(b),
          beforeB = await client.humanSlaJob.findMany({
            where: { cycleId: bCycle.id },
          });
        const a = await make(),
          aCycle = await cycleOf(a);
        assert.equal(
          (
            await request(
              `/human-sla-rules/${ruleA}`,
              0,
              { firstAlertMinutes: 3 },
              'PATCH',
            )
          ).status,
          200,
        );
        assert.equal((await cycleOf(a)).firstAlertMinutes, 5);
        const newer = await make();
        assert.equal((await cycleOf(newer)).firstAlertMinutes, 3);
        assert.deepEqual(
          await client.humanSlaJob.findMany({ where: { cycleId: bCycle.id } }),
          beforeB,
        );
        assert.equal(
          (
            await request(
              `/human-sla-rules/${ruleA}`,
              0,
              { active: false },
              'PATCH',
            )
          ).status,
          200,
        );
        assert(
          (
            await client.humanSlaCycle.findUniqueOrThrow({
              where: { id: aCycle.id },
            })
          ).endedAt,
        );
        const noJobs = await make();
        assert.equal(
          await client.humanSlaCycle.count({
            where: { conversationId: noJobs },
          }),
          0,
        );
        assert.equal((await get(a)).slaLevel, 'NONE');
        assert.equal(
          (await request(`/human-sla-rules/${ruleA}`, 0, config, 'PATCH'))
            .status,
          200,
        );
        assert.equal(
          await client.humanSlaCycle.count({
            where: { conversationId: a, endedAt: null },
          }),
          0,
        );
      },
    );
    await t.test(
      'externo desabilitado não cria job; interno desabilitado permite apenas externo',
      async () => {
        await request(
          `/human-sla-rules/${ruleA}`,
          0,
          { externalAlertEnabled: false, externalAlertMinutes: null },
          'PATCH',
        );
        const id = await make(),
          cycle = await cycleOf(id);
        assert.equal(
          await client.humanSlaJob.count({
            where: { cycleId: cycle.id, level: 'EXTERNAL' },
          }),
          0,
        );
        await request(
          `/human-sla-rules/${ruleA}`,
          0,
          { ...config, internalAlertEnabled: false },
          'PATCH',
        );
        const externalOnly = await make(),
          cycle2 = await cycleOf(externalOnly);
        assert.deepEqual(
          (
            await client.humanSlaJob.findMany({ where: { cycleId: cycle2.id } })
          ).map((job) => job.level),
          ['EXTERNAL'],
        );
        await request(`/human-sla-rules/${ruleA}`, 0, config, 'PATCH');
      },
    );
    await t.test(
      'BullMQ real: delay, duplicação, retorno do worker, socket isolado, claim limpa e retry faz SKIP',
      async () => {
        // Keep this scenario isolated from the earlier timestamp fixtures in the same database.
        await request(
          `/human-sla-rules/${ruleA}`,
          0,
          { active: false },
          'PATCH',
        );
        await request(
          `/human-sla-rules/${ruleB}`,
          2,
          { active: false },
          'PATCH',
        );
        await request(
          `/human-sla-rules/${ruleA}`,
          0,
          { active: true },
          'PATCH',
        );
        const eventsA: Record<string, unknown>[] = [],
          eventsB: Record<string, unknown>[] = [];
        async function socket(
          actor: number,
          events: Record<string, unknown>[],
        ) {
          const ws = new WebSocket(url.replace('http:', 'ws:') + '/realtime', {
            headers: {
              Cookie: cookies[actor]!,
              Origin: process.env.AUTH_ORIGIN!,
            },
          });
          sockets.push(ws);
          ws.on('message', (data) => events.push(JSON.parse(data.toString())));
          ws.on('error', () => {});
          await until(() => events.some((e) => e.type === 'realtime.ready'));
          return ws;
        }
        await socket(0, eventsA);
        await socket(2, eventsB);
        const id = await make();
        const cycle = await age(id, 5 - 2 / 60);
        queue = createHumanSlaQueue(redis!);
        await queue.waitUntilReady();
        await Promise.all([
          dispatchHumanSlaJobs(client, queue),
          dispatchHumanSlaJobs(client, queue),
        ]);
        const jobs = await client.humanSlaJob.findMany({
          where: { cycleId: cycle.id },
        });
        const queued = await queue.getJobs(['waiting', 'delayed']);
        for (const job of jobs) {
          assert.equal(queued.filter((entry) => entry.id === job.id).length, 1);
          const entry = await queue.getJob(job.id);
          assert.deepEqual(Object.keys(entry!.data).sort(), [
            'jobId',
            'tenantId',
          ]);
        }
        worker = createHumanSlaWorker(client, redis!);
        await worker.waitUntilReady();
        await delay(100);
        assert.equal((await get(id)).slaLevel, 'NONE');
        await until(() =>
          eventsA.some(
            (e) =>
              e.type === 'conversation.sla_updated' && e.conversationId === id,
          ),
        );
        assert.equal((await get(id)).slaLevel, 'FIRST');
        assert.equal(eventsB.filter((e) => e.conversationId === id).length, 0);
        const frame = eventsA.find(
          (e) =>
            e.type === 'conversation.sla_updated' && e.conversationId === id,
        )!;
        assert.deepEqual(Object.keys(frame).sort(), [
          'conversationId',
          'eventId',
          'tenantId',
          'type',
        ]);
        const before = eventsA.length;
        assert.equal((await op(id, 'claim')).status, 200);
        await until(() =>
          eventsA
            .slice(before)
            .some(
              (e) =>
                e.type === 'conversation.sla_updated' &&
                e.conversationId === id,
            ),
        );
        assert.equal((await get(id)).slaLevel, 'NONE');
        const second = jobs.find((job) => job.level === 'SECOND')!;
        const delayed = await queue.getJob(second.id);
        await delayed!.promote();
        await until(
          async () => (await queue!.getJob(second.id))?.isCompleted() ?? false,
        );
        assert.equal(
          await client.authEvent.count({
            where: { resourceId: id, type: 'HUMAN_SLA_SECOND_ALERT' },
          }),
          0,
        );
        await worker.close();
        worker = undefined;
      },
    );
    await t.test(
      'outbox recupera job removido do Redis e estado SQL impede inconsistência cross-tenant',
      async () => {
        const id = await make(),
          cycle = await age(id, 6);
        await dispatchHumanSlaJobs(client, queue!);
        const job = await client.humanSlaJob.findFirstOrThrow({
          where: { cycleId: cycle.id, level: 'FIRST' },
        });
        await (await queue!.getJob(job.id))!.remove();
        await client.humanSlaJob.update({
          where: { id: job.id },
          data: { nextDispatchAt: new Date(0) },
        });
        await dispatchHumanSlaJobs(client, queue!);
        assert(await queue!.getJob(job.id));
        await assert.rejects(
          client.humanSlaJob.create({
            data: {
              tenantId: tb.id,
              cycleId: cycle.id,
              level: 'FIRST',
              dueAt: new Date(),
            },
          }),
        );
        await assert.rejects(
          client.humanSlaRule.update({
            where: { id: ruleA },
            data: { secondAlertMinutes: 1 },
          }),
        );
        await op(id, 'claim');
        await assert.rejects(
          client.conversation.update({
            where: { id },
            data: { slaLevel: 'FIRST' },
          }),
        );
      },
    );
  } finally {
    if (worker) await worker.close();
    if (queue) await queue.close();
    for (const socket of sockets) socket.terminate();
    await app.close();
    await client.$disconnect();
  }
});
