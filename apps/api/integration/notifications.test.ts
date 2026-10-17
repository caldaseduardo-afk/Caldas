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
import {
  weekdays,
  civilDate,
  localTime,
} from '../src/availability/availability.dto';
import { createNotificationDto } from '../src/notifications/notification.dto';
import {
  resolveNotificationSchedule,
  resolveRetrySchedule,
} from '../src/notifications/notification.schedule';
import { NotificationRepository } from '../src/notifications/notification.repository';
import { NotificationsService } from '../src/notifications/notifications.service';
const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).pathname !== '/task002_test' ||
  connection !== process.env.DATABASE_URL
)
  throw new Error('Use pnpm db:test.');
test('NotificationRule: persistência, preview único, timezone, segurança e nenhuma ação externa', async (t) => {
  const client = createDatabaseClient(connection),
    app = await createApplication();
  try {
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const ta = await client.tenant.create({
      data: {
        name: 'Notificações A',
        status: 'ACTIVE',
        timezone: 'America/Sao_Paulo',
      },
    });
    const tb = await client.tenant.create({
      data: { name: 'Notificações B', status: 'ACTIVE', timezone: 'UTC' },
    });
    const ua = await client.unit.create({
      data: { tenantId: ta.id, name: 'A', address: 'Rua A' },
    });
    const ub = await client.unit.create({
      data: { tenantId: tb.id, name: 'B', address: 'Rua B' },
    });
    const override = await client.unit.create({
      data: {
        tenantId: ta.id,
        name: 'Override',
        address: 'Rua A',
        timezoneOverride: 'America/New_York',
      },
    });
    const password = 'senha longa notificacoes teste',
      passwordHash = await hashPassword(password);
    const users: { id: string; email: string; name: string }[] = [];
    for (const [tenantId, role] of [
      [ta.id, 'CLINIC_ADMIN'],
      [tb.id, 'CLINIC_ADMIN'],
      [ta.id, 'AGENT'],
      [ta.id, 'DOCTOR'],
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
    const request = (
      path: string,
      cookie = '',
      method = 'GET',
      body?: unknown,
      origin = process.env.AUTH_ORIGIN!,
    ) =>
      fetch(url + path, {
        method,
        headers: {
          Cookie: cookie,
          Origin: origin,
          'Content-Type': 'application/json',
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
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
      agent = await login(2, ta.id),
      doctor = await login(3, ta.id);
    const data = {
      type: 'CONFIRMATION',
      offsetMinutes: 240,
      allowedStartTime: '08:00',
      allowedEndTime: '20:00',
      allowedWeekdays: [...weekdays],
      outsideWindowPolicy: 'PREVIOUS_ALLOWED_TIME',
    };
    type Rule = {
      id: string;
      type: string;
      active: boolean;
      allowedStartTime: string;
      allowedEndTime: string;
      actionIfNoResponse: string;
      retryEnabled: boolean;
      maxAttempts: number;
    };
    const create = async (extra: Record<string, unknown> = {}, cookie = a) => {
      const r = await request('/notification-rules', cookie, 'POST', {
        ...data,
        ...extra,
      });
      assert.equal(r.status, 201, await r.clone().text());
      return (await r.json()) as Rule;
    };
    let rule: Rule, foreign: Rule;
    const appointmentStart = '2026-10-06T11:00:00Z';
    const preview = (
      id: string,
      extra: Record<string, unknown> = {},
      cookie = a,
    ) =>
      request(`/notification-rules/${id}/preview`, cookie, 'POST', {
        appointmentStart,
        ...extra,
      });
    const patient = await client.patient.create({
      data: {
        tenantId: ta.id,
        name: 'Paciente',
        birthDate: civilDate('2000-01-01'),
      },
    });
    const specialty = await client.specialty.create({
      data: { tenantId: ta.id, name: 'Área' },
    });
    const service = await client.service.create({
      data: {
        tenantId: ta.id,
        specialtyId: specialty.id,
        name: 'Consulta',
        durationMinutes: 40,
      },
    });
    const provider = await client.provider.create({
      data: {
        tenantId: ta.id,
        name: 'Profissional',
        professionalType: 'DOCTOR',
      },
    });
    await client.providerService.create({
      data: { tenantId: ta.id, providerId: provider.id, serviceId: service.id },
    });
    for (const unit of [ua, override])
      await client.providerUnit.create({
        data: { tenantId: ta.id, providerId: provider.id, unitId: unit.id },
      });
    const appointment = await client.appointment.create({
      data: {
        tenantId: ta.id,
        patientId: patient.id,
        serviceId: service.id,
        providerId: provider.id,
        unitId: ua.id,
        startAt: new Date(appointmentStart),
        endAt: new Date('2026-10-06T11:40:00Z'),
        occupiedStartAt: new Date(appointmentStart),
        occupiedEndAt: new Date('2026-10-06T11:40:00Z'),
        createdByType: 'USER',
        createdById: users[0]!.id,
      },
    });
    const resolution = (
      id: string,
      appointmentId = appointment.id,
      extra: Record<string, unknown> = {},
      cookie = a,
    ) =>
      request(`/notification-rules/${id}/resolve`, cookie, 'POST', {
        appointmentId,
        ...extra,
      });
    await t.test(
      'cria tipos independentes, múltiplas regras equivalentes e projeção sem tenant/timestamps',
      async () => {
        rule = await create();
        foreign = await create({}, b);
        const duplicate = await create();
        const reminder = await create({
          type: 'REMINDER',
          offsetMinutes: 60,
          actionIfNoResponse: 'NEEDS_HUMAN',
        });
        assert.notEqual(rule.id, duplicate.id);
        assert.equal(reminder.type, 'REMINDER');
        assert.equal(reminder.actionIfNoResponse, 'NEEDS_HUMAN');
        assert.equal(rule.actionIfNoResponse, 'NONE');
        assert.equal(rule.retryEnabled, false);
        assert.equal(rule.maxAttempts, 1);
        assert.equal(rule.allowedStartTime, '08:00');
        assert.equal(rule.allowedEndTime, '20:00');
        for (const key of ['tenantId', 'createdAt', 'updatedAt', 'tenant'])
          assert.ok(!(key in rule));
        const r = await request(
          '/notification-rules?type=REMINDER&active=true',
          a,
        );
        assert.equal(r.status, 200);
        const rows = (await r.json()) as Rule[];
        assert.equal(rows.length, 1);
        assert.equal(rows[0]!.id, reminder.id);
        const all = await request('/notification-rules', a);
        assert.equal(((await all.json()) as Rule[]).length, 3);
      },
    );
    await t.test(
      'validação de criação e PATCH final impede estado inconsistente; inativação/reativação',
      async () => {
        for (const extra of [
          { offsetMinutes: -1 },
          { allowedStartTime: '20:00' },
          { allowedEndTime: '07:00' },
          { allowedWeekdays: [] },
          { retryEnabled: true, retryAfterMinutes: 0 },
          { retryEnabled: true, retryAfterMinutes: null },
          { maxAttempts: 0 },
          { minimumTimeBeforeAppointment: -1 },
          { tenantId: tb.id },
        ])
          assert.equal(
            (
              await request('/notification-rules', a, 'POST', {
                ...data,
                ...extra,
              })
            ).status,
            400,
          );
        assert.equal(
          (
            await request(`/notification-rules/${rule.id}`, a, 'PATCH', {
              allowedStartTime: '21:00',
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request(`/notification-rules/${rule.id}`, a, 'PATCH', {
              retryEnabled: true,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request(`/notification-rules/${rule.id}`, a, 'PATCH', {
              active: false,
            })
          ).status,
          200,
        );
        assert.deepEqual(await (await preview(rule.id)).json(), {
          decision: 'SKIP',
          scheduledAt: null,
          reason: 'INACTIVE_RULE',
        });
        assert.equal(
          (
            await request(`/notification-rules/${rule.id}`, a, 'PATCH', {
              active: true,
            })
          ).status,
          200,
        );
        const fetched = await request(`/notification-rules/${rule.id}`, a);
        assert.equal(((await fetched.json()) as Rule).active, true);
        assert.equal(
          (await request(`/notification-rules/${rule.id}`, a, 'DELETE')).status,
          404,
        );
      },
    );
    await t.test(
      'tenant alheio não pode ler/alterar/calcular regra nem unidade/Appointment',
      async () => {
        for (const [path, method, body] of [
          [`/notification-rules/${foreign.id}`, 'GET', undefined],
          [`/notification-rules/${foreign.id}`, 'PATCH', { active: false }],
          [
            `/notification-rules/${foreign.id}/preview`,
            'POST',
            { appointmentStart },
          ],
          [
            `/notification-rules/${foreign.id}/resolve`,
            'POST',
            { appointmentId: appointment.id },
          ],
        ] as const)
          assert.equal((await request(path, a, method, body)).status, 404);
        assert.equal((await preview(rule.id, { unitId: ub.id })).status, 404);
        assert.equal(
          (await resolution(foreign.id, appointment.id, {}, b)).status,
          404,
        );
        assert.equal(
          (await request(`/notification-rules/${rule.id}`, b)).status,
          404,
        );
        assert.equal(
          (await request('/notification-rules?tenantId=' + ta.id, b)).status,
          400,
        );
      },
    );
    await t.test(
      'RBAC e CSRF; nenhuma permissão apenas por conhecer ids',
      async () => {
        assert.equal((await request('/notification-rules')).status, 401);
        for (const cookie of [agent, doctor]) {
          assert.equal(
            (await request('/notification-rules', cookie)).status,
            403,
          );
          assert.equal(
            (await request('/notification-rules', cookie, 'POST', data)).status,
            403,
          );
          assert.equal((await preview(rule.id, {}, cookie)).status, 403);
          assert.equal(
            (await resolution(rule.id, appointment.id, {}, cookie)).status,
            403,
          );
        }
        assert.equal(
          (
            await request(
              '/notification-rules',
              a,
              'POST',
              data,
              'https://evil.test',
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      'preview e Appointment usam exatamente motor único e timezone da unidade/tenant',
      async () => {
        const expected = resolveNotificationSchedule(
          new Date(appointmentStart),
          ta.timezone,
          createNotificationDto(data),
        );
        assert.deepEqual(expected, {
          decision: 'SCHEDULE',
          scheduledAt: '2026-10-05T23:00:00.000Z',
          reason: null,
        });
        for (const response of [
          await preview(rule.id),
          await preview(rule.id, { unitId: ua.id }),
          await resolution(rule.id),
        ]) {
          assert.equal(response.status, 200);
          assert.deepEqual(await response.json(), expected);
        }
        const newYork = resolveNotificationSchedule(
          new Date(appointmentStart),
          'America/New_York',
          createNotificationDto(data),
        );
        assert.deepEqual(
          await (await preview(rule.id, { unitId: override.id })).json(),
          newYork,
        );
        assert.notDeepEqual(newYork, expected);
        await client.appointment.update({
          where: { id: appointment.id },
          data: { unitId: override.id },
        });
        assert.deepEqual(await (await resolution(rule.id)).json(), newYork);
        await client.appointment.update({
          where: { id: appointment.id },
          data: { unitId: ua.id },
        });
        assert.equal((await preview(rule.id, { timezone: 'UTC' })).status, 400);
        assert.equal(
          (await preview(rule.id, { appointmentStart: '2026-10-06T08:00:00' }))
            .status,
          400,
        );
      },
    );
    await t.test(
      'retry aplica mesmo resolvedor, limite total e mínimo; intenção CANCEL não altera consulta',
      async () => {
        const retryData = {
          retryEnabled: true,
          retryAfterMinutes: 240,
          maxAttempts: 2,
          outsideWindowPolicy: 'NEXT_ALLOWED_TIME',
          actionIfNoResponse: 'CANCEL_APPOINTMENT',
        };
        const rr = await create(retryData);
        const start = '2026-10-06T15:00:00Z',
          previousAttemptAt = '2026-10-05T22:00:00Z';
        const expected = resolveRetrySchedule(
          new Date(previousAttemptAt),
          new Date(start),
          ta.timezone,
          createNotificationDto({ ...data, ...retryData }),
          2,
        );
        assert.deepEqual(expected, {
          decision: 'SCHEDULE',
          scheduledAt: '2026-10-06T11:00:00.000Z',
          reason: null,
        });
        assert.deepEqual(
          await (
            await preview(rr.id, {
              appointmentStart: start,
              previousAttemptAt,
              attemptNumber: 2,
            })
          ).json(),
          expected,
        );
        assert.deepEqual(
          await (
            await preview(rr.id, {
              appointmentStart: start,
              previousAttemptAt,
              attemptNumber: 3,
            })
          ).json(),
          { decision: 'SKIP', scheduledAt: null, reason: 'MAX_ATTEMPTS' },
        );
        assert.deepEqual(
          await (
            await resolution(rr.id, appointment.id, {
              previousAttemptAt,
              attemptNumber: 2,
            })
          ).json(),
          {
            decision: 'SKIP',
            scheduledAt: null,
            reason: 'AT_OR_AFTER_APPOINTMENT',
          },
        );
        assert.equal(
          (
            await client.appointment.findUniqueOrThrow({
              where: { id: appointment.id },
            })
          ).status,
          'PENDING_CONFIRMATION',
        );
        assert.equal(
          await client.authEvent.count({
            where: { tenantId: ta.id, type: 'APPOINTMENT_CANCELLED' },
          }),
          0,
        );
        assert.equal((await preview(rr.id, { previousAttemptAt })).status, 400);
        await client.appointment.update({
          where: { id: appointment.id },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
        });
        assert.deepEqual(await (await resolution(rr.id)).json(), {
          decision: 'SKIP',
          scheduledAt: null,
          reason: 'APPOINTMENT_INACTIVE',
        });
      },
    );
    await t.test(
      'CHECKs/FK protegem SQL direto e auditoria de configuração registra ator/tenant',
      async () => {
        const config = createNotificationDto(data);
        for (const patch of [
          { tenantId: randomUUID() },
          { offsetMinutes: -1 },
          { allowedStartTime: localTime('20:00') },
          { allowedWeekdays: [] },
          { retryEnabled: true, retryAfterMinutes: null },
          { retryEnabled: true, retryAfterMinutes: 0 },
          { maxAttempts: 0 },
          { minimumTimeBeforeAppointment: -1 },
        ])
          await assert.rejects(
            client.notificationRule.create({
              data: { ...config, tenantId: ta.id, ...patch },
            }),
          );
        await assert.rejects(
          client.$executeRaw`UPDATE notification_rules SET allowed_weekdays=NULL WHERE id=${rule.id}::uuid`,
        );
        await assert.rejects(
          client.$executeRaw`UPDATE notification_rules SET allowed_weekdays=ARRAY[NULL]::"Weekday"[] WHERE id=${rule.id}::uuid`,
        );
        await assert.rejects(
          client.$executeRaw`UPDATE notification_rules SET allowed_start_time=TIME '08:00:01' WHERE id=${rule.id}::uuid`,
        );
        const events = await client.authEvent.findMany({
          where: {
            tenantId: ta.id,
            resourceId: rule.id,
            type: {
              in: ['NOTIFICATION_RULE_CREATED', 'NOTIFICATION_RULE_UPDATED'],
            },
          },
        });
        assert.equal(events.length, 3);
        assert.ok(events.every((x) => x.userId === users[0]!.id));
      },
    );
    await t.test(
      'rollback da auditoria e revogação entre service/repository não persistem mudanças',
      async () => {
        const session = await client.authSession.findUniqueOrThrow({
          where: { tokenHash: tokenHash(a.split('=')[1]!) },
        });
        const database = { client } as DatabaseService;
        const auth = new AuthorizationService(
          database,
          new TenantContext(
            {
              identity: users[0],
              sessionId: session.id,
              activeTenantId: ta.id,
            } as AuthRequest,
            database,
          ),
        );
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
        const before = await client.notificationRule.count({
          where: { tenantId: ta.id },
        });
        await assert.rejects(
          new NotificationRepository(failing, auth).create(
            createNotificationDto(data),
          ),
        );
        assert.equal(
          await client.notificationRule.count({ where: { tenantId: ta.id } }),
          before,
        );
        await assert.rejects(
          new NotificationRepository(failing, auth).update(rule.id, {
            active: false,
          }),
        );
        assert.equal(
          (
            await client.notificationRule.findUniqueOrThrow({
              where: { id: rule.id },
            })
          ).active,
          true,
        );
        const original = auth.requirePermissions.bind(auth);
        auth.requirePermissions = async (...permissions) => {
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
            new NotificationRepository(database, auth).create(
              createNotificationDto(data),
            ),
            ForbiddenException,
          );
        } finally {
          await client.userTenant.update({
            where: {
              userId_tenantId: { userId: users[0]!.id, tenantId: ta.id },
            },
            data: { active: true },
          });
        }
        const empty = new AuthorizationService(
          database,
          new TenantContext({} as AuthRequest, database),
        );
        const repository = new NotificationRepository(database, empty);
        await assert.rejects(repository.find(rule.id));
        await assert.rejects(
          new NotificationsService(repository, empty).create(data),
        );
      },
    );
  } finally {
    await app.close();
    await client.$disconnect();
  }
});
