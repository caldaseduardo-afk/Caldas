import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createDatabaseClient, type Prisma } from '@atendente/database';
import type { DashboardResponse } from '@atendente/types';
import { createApplication } from '../src/bootstrap';
import { tokenHash } from '../src/auth/auth.service';
const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).pathname !== '/task002_test' ||
  connection !== process.env.DATABASE_URL
)
  throw new Error('Use pnpm db:test.');
test('TASK-031: dashboard real, fórmulas, tenant, timezone, SLA e conversão histórica', async (t) => {
  const db = createDatabaseClient(connection),
    app = await createApplication();
  try {
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    async function identity(tenantId: string, role: string) {
      const user = await db.user.create({
        data: {
          name: 'Admin',
          email: `${randomUUID()}@test.local`,
          passwordHash: 'not-login',
          memberships: { create: { tenantId, role } },
        },
      });
      const token = randomBytes(32).toString('base64url');
      await db.authSession.create({
        data: {
          userId: user.id,
          activeTenantId: tenantId,
          tokenHash: tokenHash(token),
          expiresAt: new Date(Date.now() + 600000),
        },
      });
      return { id: user.id, cookie: `atendente_session=${token}` };
    }
    async function clinic(name: string) {
      const tenant = await db.tenant.create({
        data: { name, status: 'ACTIVE', timezone: 'America/Sao_Paulo' },
      });
      const user = await identity(tenant.id, 'CLINIC_ADMIN');
      const unit = await db.unit.create({
        data: { tenantId: tenant.id, name: 'Unidade ' + name, address: 'Rua' },
      });
      const provider = await db.provider.create({
        data: {
          tenantId: tenant.id,
          name: 'Profissional ' + name,
          professionalType: 'DOCTOR',
        },
      });
      const specialty = await db.specialty.create({
        data: { tenantId: tenant.id, name: 'Área' },
      });
      const service = await db.service.create({
        data: {
          tenantId: tenant.id,
          specialtyId: specialty.id,
          name: 'Consulta ' + name,
          durationMinutes: 30,
        },
      });
      const patient = await db.patient.create({
        data: {
          tenantId: tenant.id,
          name: 'PRIVATE PATIENT',
          birthDate: new Date('2000-01-01Z'),
        },
      });
      await db.providerService.create({
        data: {
          tenantId: tenant.id,
          providerId: provider.id,
          serviceId: service.id,
        },
      });
      await db.providerUnit.create({
        data: { tenantId: tenant.id, providerId: provider.id, unitId: unit.id },
      });
      const rule = await db.humanSlaRule.create({
        data: {
          tenantId: tenant.id,
          firstAlertMinutes: 1,
          secondAlertMinutes: 3,
          externalAlertMinutes: 5,
          internalAlertEnabled: true,
          externalAlertEnabled: true,
        },
      });
      return { tenant, user, unit, provider, service, patient, rule };
    }
    const a = await clinic('A'),
      b = await clinic('B');
    const get = (
      query = 'period=CUSTOM&from=2026-01-15&to=2026-01-15',
      cookie = a.user.cookie,
    ) => fetch(`${url}/analytics/dashboard?${query}`, { headers: { cookie } });
    const dashboard = async (query?: string) => {
      const response = await get(query);
      assert.equal(response.status, 200, await response.clone().text());
      return (await response.json()) as DashboardResponse;
    };
    async function appointment(
      c: typeof a,
      hour: number,
      status:
        | 'CONFIRMED'
        | 'CANCELLED'
        | 'NO_SHOW'
        | 'RESCHEDULED'
        | 'COMPLETED' = 'CONFIRMED',
      source: 'WHATSAPP_AI' | 'WHATSAPP_HUMAN' | 'WEB' | 'MANUAL' = 'MANUAL',
    ) {
      const startAt = new Date(
          Date.parse('2026-01-15T03:00:00Z') + hour * 3600000,
        ),
        endAt = new Date(+startAt + 1800000);
      return db.appointment.create({
        data: {
          tenantId: c.tenant.id,
          patientId: c.patient.id,
          serviceId: c.service.id,
          providerId: c.provider.id,
          unitId: c.unit.id,
          startAt,
          endAt,
          occupiedStartAt: startAt,
          occupiedEndAt: endAt,
          status,
          source,
          createdByType: source === 'WHATSAPP_AI' ? 'AI' : 'SYSTEM',
          cancelledAt: status === 'CANCELLED' ? startAt : null,
        },
      });
    }
    async function conversation(
      c: typeof a,
      status:
        | 'AI_ACTIVE'
        | 'HUMAN_ACTIVE'
        | 'NEEDS_HUMAN'
        | 'WAITING_PATIENT'
        | 'RESOLVED'
        | 'CLOSED',
      level: 'NONE' | 'FIRST' | 'SECOND' | 'EXTERNAL' = 'NONE',
    ) {
      const contact = await db.contact.create({
        data: { tenantId: c.tenant.id, displayName: 'PRIVATE CONTACT' },
      });
      const row = await db.conversation.create({
        data: {
          tenantId: c.tenant.id,
          contactId: contact.id,
          status,
          slaLevel: level,
          assignedUserId: status === 'HUMAN_ACTIVE' ? c.user.id : null,
          assignedAt:
            status === 'HUMAN_ACTIVE' ? new Date('2026-01-15T12:00Z') : null,
          handoffReason: status === 'NEEDS_HUMAN' ? 'OTHER' : null,
          handoffRequestedAt:
            status === 'NEEDS_HUMAN' ? new Date('2026-01-15T11:00Z') : null,
          resolvedAt: ['RESOLVED', 'CLOSED'].includes(status)
            ? new Date('2026-01-15T12:00Z')
            : null,
        },
      });
      await db.message.create({
        data: {
          tenantId: c.tenant.id,
          conversationId: row.id,
          channel: 'WHATSAPP',
          senderType: status === 'HUMAN_ACTIVE' ? 'USER' : 'AI',
          senderUserId: status === 'HUMAN_ACTIVE' ? c.user.id : null,
          messageType: 'TEXT',
          content: 'PRIVATE CONTENT',
          createdAt: new Date('2026-01-15T12:00Z'),
        },
      });
      return row;
    }
    const appointments = [];
    for (let i = 0; i < 10; i++)
      appointments.push(
        await appointment(
          a,
          i,
          i < 6
            ? 'CONFIRMED'
            : i < 8
              ? 'CANCELLED'
              : i === 8
                ? 'NO_SHOW'
                : 'RESCHEDULED',
          i < 3
            ? 'WHATSAPP_AI'
            : i < 6
              ? 'WHATSAPP_HUMAN'
              : i === 6
                ? 'WEB'
                : 'MANUAL',
        ),
      );
    const conversations: Awaited<ReturnType<typeof conversation>>[] = [];
    for (const status of [
      'AI_ACTIVE',
      'AI_ACTIVE',
      'AI_ACTIVE',
      'HUMAN_ACTIVE',
      'HUMAN_ACTIVE',
      'NEEDS_HUMAN',
      'WAITING_PATIENT',
    ] as const)
      conversations.push(
        await conversation(
          a,
          status,
          status === 'NEEDS_HUMAN' ? 'FIRST' : 'NONE',
        ),
      );
    async function cycle(
      c: typeof a,
      conversationId: string,
      minutes: number,
      index: number,
      claimed = true,
    ) {
      const requestedAt = new Date(
          Date.parse('2026-01-15T15:00Z') + index * 3600000,
        ),
        claimedAt = new Date(+requestedAt + minutes * 60000);
      return db.humanSlaCycle.create({
        data: {
          tenantId: c.tenant.id,
          conversationId,
          ruleId: c.rule.id,
          requestedAt,
          claimedAt: claimed ? claimedAt : null,
          endedAt: claimed ? claimedAt : null,
          firstAlertMinutes: 1,
          secondAlertMinutes: 3,
          externalAlertMinutes: 5,
          internalAlertEnabled: true,
          externalAlertEnabled: true,
        },
      });
    }
    const cycles = [];
    for (let i = 0; i < 3; i++)
      cycles.push(await cycle(a, conversations[3].id, (i + 1) * 2, i));
    await cycle(a, conversations[5].id, 50, 4, false);
    async function event(
      c: typeof a,
      resourceId: string,
      type: Prisma.AuthEventCreateInput['type'],
      at: string,
      changes: Prisma.InputJsonValue,
    ) {
      return db.authEvent.create({
        data: {
          tenantId: c.tenant.id,
          resourceId,
          type,
          createdAt: new Date(at),
          changes,
        },
      });
    }
    await event(
      a,
      conversations[5].id,
      'HUMAN_HANDOFF_REQUESTED',
      '2026-01-15T11:00Z',
      {},
    );
    await event(
      a,
      conversations[3].id,
      'HUMAN_SLA_FIRST_ALERT',
      '2026-01-15T15:01Z',
      { cycleId: cycles[0].id },
    );
    await event(
      a,
      conversations[3].id,
      'HUMAN_SLA_SECOND_ALERT',
      '2026-01-15T15:02Z',
      { cycleId: cycles[0].id },
    );
    const workflow = randomUUID();
    await event(
      a,
      workflow,
      'SCHEDULING_WORKFLOW_STARTED',
      '2026-01-15T04:00Z',
      { workflowType: 'SCHEDULING' },
    );
    await event(
      a,
      workflow,
      'SCHEDULING_WORKFLOW_COMPLETED',
      '2026-01-15T04:01Z',
      { appointmentId: appointments[0].id },
    );
    await event(
      a,
      workflow,
      'SCHEDULING_WORKFLOW_STARTED',
      '2026-01-15T05:00Z',
      { workflowType: 'SCHEDULING' },
    ); // abandoned, same reused workflow
    await event(
      a,
      randomUUID(),
      'SCHEDULING_WORKFLOW_STARTED',
      '2026-01-15T06:00Z',
      { workflowType: 'CANCELLATION' },
    );
    const manualWorkflow = randomUUID();
    await event(
      a,
      manualWorkflow,
      'SCHEDULING_WORKFLOW_STARTED',
      '2026-01-15T07:00Z',
      { workflowType: 'SCHEDULING' },
    );
    await event(
      a,
      manualWorkflow,
      'SCHEDULING_WORKFLOW_COMPLETED',
      '2026-01-15T07:01Z',
      { appointmentId: appointments[6].id },
    );
    const initial = await dashboard();
    await t.test(
      'end-to-end: 9 consultas, status, origens, 7 conversas e média de 4 minutos',
      () => {
        assert.equal(initial.appointments.total, 9);
        assert.equal(initial.appointments.confirmed, 6);
        assert.equal(initial.appointments.cancelled, 2);
        assert.equal(initial.appointments.noShow, 1);
        assert.equal(initial.appointments.confirmationRate, 85.71);
        assert.equal(initial.appointments.cancellationRate, 22.22);
        assert.equal(initial.appointments.noShowRate, 100);
        assert.equal(initial.conversations.total, 7);
        assert.equal(initial.current.aiActive, 3);
        assert.equal(initial.current.humanActive, 2);
        assert.equal(initial.current.needsHuman, 1);
        assert.equal(initial.current.waitingPatient, 1);
        assert.equal(initial.humanService.avgResponseSeconds, 240);
        assert.equal(initial.humanService.claimedCycles, 3);
        assert.equal(initial.humanService.violations, 1);
        assert.equal(initial.current.firstAlert, 1);
        assert.deepEqual(initial.conversion, {
          started: 3,
          completed: 1,
          rate: 33.33,
        });
        assert.equal(
          initial.appointments.sources.find((s) => s.source === 'WHATSAPP_AI')
            ?.count,
          3,
        );
        assert.equal(
          initial.appointments.sources.find(
            (s) => s.source === 'WHATSAPP_HUMAN',
          )?.count,
          3,
        );
        assert.equal(
          initial.appointments.sources.find((s) => s.source === 'WEB')?.count,
          1,
        );
        assert.equal(
          initial.appointmentSeries.reduce((n, r) => n + r.total, 0),
          9,
        );
        assert.equal(initial.rankings.length, 3);
        assert(initial.rankings.every((r) => r.count === 9));
        assert(!JSON.stringify(initial).includes('PRIVATE'));
        assert(!JSON.stringify(initial).includes(a.tenant.id));
      },
    );
    await t.test(
      'Tenant B não altera cards, séries, SLA, workflows ou rankings do Tenant A',
      async () => {
        const foreignAppointment = await appointment(b, 0);
        const foreignConversation = await conversation(
          b,
          'NEEDS_HUMAN',
          'EXTERNAL',
        );
        await cycle(b, foreignConversation.id, 100, 0);
        await event(
          b,
          foreignConversation.id,
          'HUMAN_HANDOFF_REQUESTED',
          '2026-01-15T11:00Z',
          {},
        );
        await event(
          b,
          foreignConversation.id,
          'HUMAN_SLA_EXTERNAL_ALERT_REQUIRED',
          '2026-01-15T11:00Z',
          { cycleId: randomUUID() },
        );
        await event(
          b,
          workflow,
          'SCHEDULING_WORKFLOW_STARTED',
          '2026-01-15T04:00Z',
          { workflowType: 'SCHEDULING' },
        );
        await event(
          b,
          workflow,
          'SCHEDULING_WORKFLOW_COMPLETED',
          '2026-01-15T04:01Z',
          { appointmentId: foreignAppointment.id },
        );
        const result = await dashboard();
        const { generatedAt: _first, ...expected } = initial;
        const { generatedAt: _next, ...actual } = result;
        assert(_first);
        assert(_next);
        assert.deepEqual(actual, expected);
        for (const [key, id] of [
          ['unitId', b.unit.id],
          ['serviceId', b.service.id],
          ['providerId', b.provider.id],
        ])
          assert.equal((await get(`period=TODAY&${key}=${id}`)).status, 404);
      },
    );
    await t.test(
      'RBAC, DTO, ausência de sessão, filtros falsos e somente GET',
      async () => {
        for (const role of ['AGENT', 'DOCTOR', 'SUPER_ADMIN'])
          assert.equal(
            (await get(undefined, (await identity(a.tenant.id, role)).cookie))
              .status,
            403,
          );
        assert.equal((await get(undefined, '')).status, 401);
        for (const query of [
          'tenantId=' + b.tenant.id,
          'period=CUSTOM&from=2026-02-01&to=2026-01-01',
          'period=CUSTOM&from=2020-01-01&to=2026-01-01',
          'unitId=invalid',
        ])
          assert.equal((await get(query)).status, 400);
        const options = await fetch(
          url + '/analytics/dashboard/options?kind=unit',
          { headers: { cookie: a.user.cookie } },
        );
        const body = (await options.json()) as { items: { id: string }[] };
        assert.equal(options.status, 200);
        assert(body.items.every((r) => r.id !== b.unit.id));
        assert.equal(
          (
            await fetch(url + '/analytics/dashboard', {
              method: 'POST',
              headers: {
                cookie: a.user.cookie,
                Origin: process.env.AUTH_ORIGIN!,
              },
            })
          ).status,
          404,
        );
      },
    );
    await t.test(
      'filtros validados, limites UTC, dia local e períodos vazios',
      async () => {
        assert.equal(initial.period.startAt, '2026-01-15T03:00:00.000Z');
        assert.equal(initial.period.endAt, '2026-01-16T03:00:00.000Z');
        await appointment(a, -1);
        await appointment(a, 24);
        assert.equal((await dashboard()).appointments.total, 9);
        for (const [key, id] of [
          ['unitId', a.unit.id],
          ['serviceId', a.service.id],
          ['providerId', a.provider.id],
        ]) {
          const body = await dashboard(
            `period=CUSTOM&from=2026-01-15&to=2026-01-15&${key}=${id}`,
          );
          assert.equal(body.appointments.total, 9);
          assert.equal(body.appointmentSeries[0].total, 9);
        }
        const emptyUnit = await db.unit.create({
          data: { tenantId: a.tenant.id, name: 'Vazia', address: 'Rua' },
        });
        const filtered = await dashboard(
          `period=CUSTOM&from=2026-01-15&to=2026-01-15&unitId=${emptyUnit.id}`,
        );
        assert.equal(filtered.appointments.total, 0);
        assert.equal(filtered.conversations.total, 7);
        const empty = await dashboard(
          'period=CUSTOM&from=2020-01-01&to=2020-01-03',
        );
        assert.equal(empty.appointments.total, 0);
        assert.equal(empty.conversations.total, 0);
        assert.equal(empty.humanService.avgResponseSeconds, null);
        assert.equal(empty.appointmentSeries.length, 3);
        assert.equal(empty.current.needsHuman, 1);
      },
    );
    await t.test(
      'timezone de unidade e DST: dias de 23h/25h e meia-noite inexistente',
      async () => {
        const u = await db.unit.create({
          data: {
            tenantId: a.tenant.id,
            name: 'NY',
            address: 'Rua',
            timezoneOverride: 'America/New_York',
          },
        });
        for (const [date, hours] of [
          ['2026-03-08', 23],
          ['2026-11-01', 25],
        ] as const) {
          const result = await dashboard(
            `period=CUSTOM&from=${date}&to=${date}&unitId=${u.id}`,
          );
          assert.equal(
            (Date.parse(result.period.endAt) -
              Date.parse(result.period.startAt)) /
              3600000,
            hours,
          );
          assert.equal(result.period.timezone, 'America/New_York');
        }
        const historic = await dashboard(
          'period=CUSTOM&from=2018-11-04&to=2018-11-04',
        );
        assert.equal(historic.period.startAt, '2018-11-04T03:00:00.000Z');
      },
    );
    await t.test(
      'níveis atuais não recebem ciclos anteriores; mensagens não mudam status',
      async () => {
        const second = await conversation(a, 'NEEDS_HUMAN', 'SECOND');
        await conversation(a, 'NEEDS_HUMAN', 'EXTERNAL');
        await conversation(a, 'RESOLVED');
        await conversation(a, 'CLOSED');
        const current = await dashboard();
        assert.equal(current.current.firstAlert, 1);
        assert.equal(current.current.secondAlert, 1);
        assert.equal(current.current.externalAlert, 1);
        assert.equal(current.current.resolved, 1);
        assert.equal(current.current.closed, 1);
        assert.equal(current.current.aiActive, 3);
        await db.conversation.update({
          where: { id: second.id },
          data: {
            status: 'AI_ACTIVE',
            slaLevel: 'NONE',
            handoffReason: null,
            handoffRequestedAt: null,
          },
        });
        assert.equal((await dashboard()).current.secondAlert, 0);
      },
    );
    await t.test(
      'rankings top 5 e opções paginadas com ordenação estável',
      async () => {
        for (let i = 0; i < 28; i++)
          await db.unit.create({
            data: {
              tenantId: a.tenant.id,
              name: `Opção ${String(i).padStart(2, '0')}`,
              address: 'Rua',
            },
          });
        const first = (await (
          await fetch(
            url + '/analytics/dashboard/options?kind=unit&search=Opção',
            { headers: { cookie: a.user.cookie } },
          )
        ).json()) as { items: { name: string }[]; hasMore: boolean };
        const next = (await (
          await fetch(
            url + '/analytics/dashboard/options?kind=unit&search=Opção&page=2',
            { headers: { cookie: a.user.cookie } },
          )
        ).json()) as { items: { name: string }[]; hasMore: boolean };
        assert.equal(first.items.length, 25);
        assert.equal(first.hasMore, true);
        assert.equal(next.items.length, 3);
        assert.equal(next.hasMore, false);
        assert.equal(first.items[0].name, 'Opção 00');
        for (let i = 0; i < 6; i++) {
          const service = await db.service.create({
            data: {
              tenantId: a.tenant.id,
              specialtyId: a.service.specialtyId,
              name: `Ranking ${i}`,
              durationMinutes: 30,
            },
          });
          await db.providerService.create({
            data: {
              tenantId: a.tenant.id,
              providerId: a.provider.id,
              serviceId: service.id,
            },
          });
          await appointment({ ...a, service }, 12 + i, 'COMPLETED', 'WEB');
          const filtered = await dashboard(
            `period=CUSTOM&from=2026-01-15&to=2026-01-15&serviceId=${service.id}`,
          );
          assert.equal(filtered.appointments.total, 1);
          assert.equal(filtered.appointmentSeries[0].total, 1);
          assert.equal(
            filtered.rankings.find((r) => r.kind === 'service')?.name,
            `Ranking ${i}`,
          );
        }
        const ranked = await dashboard();
        const services = ranked.rankings.filter((r) => r.kind === 'service');
        assert.equal(services.length, 5);
        assert.equal(services[0].count, 9);
        assert.equal(services[1].name, 'Ranking 0');
        assert.equal(ranked.rankings.find((r) => r.kind === 'unit')?.count, 15);
        const inactive = await db.provider.create({
          data: {
            tenantId: a.tenant.id,
            name: 'Sem agenda',
            professionalType: 'DOCTOR',
            active: false,
          },
        });
        assert.equal(
          (
            await dashboard(
              `period=CUSTOM&from=2026-01-15&to=2026-01-15&providerId=${inactive.id}`,
            )
          ).appointments.total,
          0,
        );
      },
    );

    await t.test(
      'conversa repetida em dias distintos é única no total; revogação bloqueia',
      async () => {
        await db.message.create({
          data: {
            tenantId: a.tenant.id,
            conversationId: conversations[0].id,
            channel: 'WHATSAPP',
            senderType: 'AI',
            messageType: 'TEXT',
            content: 'PRIVATE',
            createdAt: new Date('2026-01-16T12:00Z'),
          },
        });
        const result = await dashboard(
          'period=CUSTOM&from=2026-01-15&to=2026-01-16',
        );
        assert.equal(
          result.conversationSeries.reduce((n, r) => n + r.total, 0),
          result.conversations.total + 1,
        );
        const before = await db.authEvent.count({
          where: { tenantId: a.tenant.id },
        });
        await dashboard();
        assert.equal(
          await db.authEvent.count({ where: { tenantId: a.tenant.id } }),
          before,
        );
        await db.userTenant.update({
          where: {
            userId_tenantId: { userId: a.user.id, tenantId: a.tenant.id },
          },
          data: { active: false },
        });
        assert.equal((await get()).status, 403);
      },
    );
  } finally {
    await app.close();
    await db.$disconnect();
  }
});
