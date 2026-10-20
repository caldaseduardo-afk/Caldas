import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  createDatabaseClient,
  createHumanSlaQueue,
  platformHealth,
  startPlatformHeartbeat,
} from '@atendente/database';
import type { PlatformOverview } from '@atendente/types';
import { createApplication } from '../src/bootstrap';
import { tokenHash } from '../src/auth/auth.service';
import { hashPassword } from '../src/auth/password';
import {
  encodeSecret,
  encryptSecret,
  totp,
} from '../src/platform-admin/platform-totp';
import {
  PlatformAuthService,
  platformTokenHash,
} from '../src/platform-admin/platform-auth.service';
import type { DatabaseService } from '../src/auth/database.service';
const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  connection !== process.env.DATABASE_URL ||
  new URL(connection).pathname !== '/task002_test'
)
  throw new Error('Use pnpm db:test.');

test('TASK-032: plataforma real, três E2Es, MFA, isolamento e minimização', async (t) => {
  process.env.PLATFORM_MFA_KEY = randomBytes(32).toString('base64');
  const db = createDatabaseClient(connection),
    app = await createApplication();
  const prefix = 'platform-' + randomUUID();
  const createdAt = new Date('2026-10-15T12:00:00Z');
  try {
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const password = randomBytes(24).toString('base64url');
    const admin = await db.user.create({
      data: {
        name: 'Platform',
        email: randomUUID() + '@test.local',
        passwordHash: await hashPassword(password),
      },
    });
    const secret = encodeSecret(randomBytes(20));
    await db.platformAdmin.create({
      data: {
        userId: admin.id,
        encryptedSecret: encryptSecret(secret, admin.id),
        enrolledAt: new Date(Date.now() - 60000),
      },
    });
    const auth = new PlatformAuthService({ client: db } as DatabaseService);
    const initialTotp = totp(secret, Math.floor(Date.now() / 30000));
    const token = await auth.login(
      admin.email,
      password,
      initialTotp,
      'test-platform',
    );
    const cookie = `platform_session=${token}`;
    const scope = await auth.authenticate(token);
    await t.test(
      'login sem TOTP só funciona com bypass explícito em desenvolvimento',
      async () => {
        const user = await db.user.create({
          data: {
            name: 'Local platform test',
            email: randomUUID() + '@test.local',
            passwordHash: await hashPassword(password),
          },
        });
        await db.platformAdmin.create({
          data: { userId: user.id, active: true },
        });
        const previousNodeEnv = process.env.NODE_ENV;
        const previousMfaDisabled = process.env.PLATFORM_MFA_DISABLED;
        const previousAuthOrigin = process.env.AUTH_ORIGIN;
        try {
          process.env.NODE_ENV = 'development';
          process.env.PLATFORM_MFA_DISABLED = 'true';
          process.env.AUTH_ORIGIN = 'http://localhost:3000';
          const localLogin = await fetch(url + '/super-admin/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: process.env.AUTH_ORIGIN,
            },
            body: JSON.stringify({ email: user.email, password }),
          });
          assert.equal(localLogin.status, 200);
          const localCookie = localLogin.headers.get('set-cookie')!;
          assert.equal(
            (
              await fetch(url + '/super-admin/session', {
                headers: { cookie: localCookie.split(';')[0]! },
              })
            ).status,
            200,
          );

          process.env.NODE_ENV = 'production';
          process.env.AUTH_ORIGIN = 'https://platform.test';
          await assert.rejects(
            auth.login(
              user.email,
              password,
              undefined,
              'production-platform-test',
            ),
            /Credenciais inválidas/,
          );
        } finally {
          if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
          else process.env.NODE_ENV = previousNodeEnv;
          if (previousMfaDisabled === undefined)
            delete process.env.PLATFORM_MFA_DISABLED;
          else process.env.PLATFORM_MFA_DISABLED = previousMfaDisabled;
          if (previousAuthOrigin === undefined) delete process.env.AUTH_ORIGIN;
          else process.env.AUTH_ORIGIN = previousAuthOrigin;
        }
      },
    );
    await assert.rejects(
      () =>
        auth.login(
          admin.email,
          password,
          initialTotp,
          'test-platform',
        ),
      /Credenciais inválidas/,
    );
    async function clinic(
      suffix: string,
      users: number,
      messages: number,
      conversations: number,
      appointments: number,
      tokens: number,
      status: 'ACTIVE' | 'SUSPENDED',
    ) {
      const tenant = await db.tenant.create({
        data: { name: prefix + suffix, status, timezone: 'America/Sao_Paulo' },
      });
      let first = '';
      for (let i = 0; i < users; i++) {
        const u = await db.user.create({
          data: {
            name: 'PRIVATE_USER',
            email: randomUUID() + '@test.local',
            passwordHash: 'unused',
            memberships: {
              create: { tenantId: tenant.id, role: 'CLINIC_ADMIN' },
            },
          },
        });
        if (!first) first = u.id;
      }
      if (!messages) return { tenant, userId: first };
      const contact = await db.contact.create({
        data: { tenantId: tenant.id, displayName: 'PRIVATE_CONTACT' },
      });
      const convo: Array<{ id: string }> = [];
      for (let i = 0; i < conversations; i++)
        convo.push(
          await db.conversation.create({
            data: {
              tenantId: tenant.id,
              contactId: contact.id,
              status: 'CLOSED',
              resolvedAt: createdAt,
              createdAt,
            },
          }),
        );
      await db.message.createMany({
        data: Array.from({ length: messages }, (_, i) => ({
          tenantId: tenant.id,
          conversationId: convo[i % convo.length]!.id,
          senderType: 'PATIENT' as const,
          channel: 'WHATSAPP' as const,
          messageType: 'TEXT' as const,
          content: 'PRIVATE_MESSAGE_12345678909',
          createdAt,
        })),
      });
      const unit = await db.unit.create({
        data: { tenantId: tenant.id, name: 'Unit', address: 'PRIVATE_ADDRESS' },
      });
      const provider = await db.provider.create({
        data: {
          tenantId: tenant.id,
          name: 'PRIVATE_PROVIDER',
          professionalType: 'DOCTOR',
        },
      });
      const specialty = await db.specialty.create({
        data: { tenantId: tenant.id, name: 'Area' },
      });
      const service = await db.service.create({
        data: {
          tenantId: tenant.id,
          specialtyId: specialty.id,
          name: 'Service',
          durationMinutes: 30,
        },
      });
      const patient = await db.patient.create({
        data: {
          tenantId: tenant.id,
          name: 'PRIVATE_PATIENT',
          birthDate: new Date('2000-01-01T00:00:00Z'),
        },
      });
      await db.providerUnit.create({
        data: { tenantId: tenant.id, providerId: provider.id, unitId: unit.id },
      });
      await db.providerService.create({
        data: {
          tenantId: tenant.id,
          providerId: provider.id,
          serviceId: service.id,
        },
      });
      for (let i = 0; i < appointments; i++) {
        const startAt = new Date(+createdAt + i * 3600000),
          endAt = new Date(+startAt + 1800000);
        await db.appointment.create({
          data: {
            tenantId: tenant.id,
            patientId: patient.id,
            unitId: unit.id,
            providerId: provider.id,
            serviceId: service.id,
            startAt,
            endAt,
            occupiedStartAt: startAt,
            occupiedEndAt: endAt,
            source: 'MANUAL',
            createdByType: 'SYSTEM',
            status: 'CONFIRMED',
            createdAt,
          },
        });
      }
      await db.aIUsage.create({
        data: {
          tenantId: tenant.id,
          provider: 'test-provider',
          model: 'test-model',
          inputTokens: tokens / 2,
          outputTokens: tokens / 2,
          totalTokens: tokens,
          status: 'SUCCESS',
          completedAt: createdAt,
          attempts: 1,
          latencyMs: 100,
          correlationId: randomUUID(),
          createdAt,
        },
      });
      await db.integration.create({
        data: {
          tenantId: tenant.id,
          phoneNumberId: `${Date.now()}${String(Math.floor(Math.random() * 100000)).padStart(5, '0')}`,
          externalAccountId: `${Date.now()}999`,
          credentialsReference: 'WHATSAPP_ACCESS_TOKEN_TEST',
          status: suffix === 'B' ? 'ERROR' : 'ACTIVE',
        },
      });
      await db.calendarIntegration.create({
        data: {
          tenantId: tenant.id,
          calendarId: 'PRIVATE_CALENDAR',
          credentialsReference: 'PRIVATE_REFRESH_TOKEN',
          status: suffix === 'B' ? 'ERROR' : 'ACTIVE',
          lastErrorCode: suffix === 'B' ? 'AUTHENTICATION' : null,
        },
      });
      return { tenant, userId: first };
    }
    const a = await clinic('A', 5, 100, 20, 10, 10000, 'ACTIVE'),
      b = await clinic('B', 3, 50, 8, 5, 5000, 'ACTIVE');
    const c = await clinic('C', 2, 0, 0, 0, 0, 'SUSPENDED');
    await t.test('TASK-036: acesso temporário, edição auditada e isolamento por clínica', async () => {
      const start = await fetch(url + `/super-admin/tenants/${a.tenant.id}/access`, {
        method: 'POST',
        headers: { cookie, Origin: process.env.AUTH_ORIGIN!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Suporte solicitado pela clínica' }),
      });
      assert.equal(start.status, 200);
      const accessCookie = start.headers.getSetCookie().find((value) => value.startsWith('platform_tenant='));
      assert.ok(accessCookie?.includes('HttpOnly'));
      assert.match(accessCookie ?? '', /Max-Age=1[0-8][0-9]{2}/);
      const clinicCookie = accessCookie!.split(';')[0]!;
      const own = await fetch(url + `/clinics/${a.tenant.id}`, { headers: { cookie: clinicCookie } });
      assert.equal(own.status, 200);
      const crossTenant = await fetch(url + `/clinics/${b.tenant.id}`, { headers: { cookie: clinicCookie } });
      assert.equal(crossTenant.status, 404);
      const rejected = await fetch(url + `/super-admin/tenants/${c.tenant.id}/access`, {
        method: 'POST',
        headers: { cookie, Origin: process.env.AUTH_ORIGIN!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Acesso à clínica suspensa' }),
      });
      assert.equal(rejected.status, 403);
      const edited = await fetch(url + `/clinics/${a.tenant.id}`, {
        method: 'PATCH',
        headers: { cookie: clinicCookie, Origin: process.env.AUTH_ORIGIN!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: prefix + 'A temporarily updated', status: 'ACTIVE', timezone: 'America/Sao_Paulo' }),
      });
      assert.equal(edited.status, 200);
      await db.tenant.update({ where: { id: a.tenant.id }, data: { name: prefix + 'A' } });
      const audit = await db.authEvent.findFirst({
        where: { tenantId: a.tenant.id, type: 'TENANT_UPDATED', resourceId: a.tenant.id },
      });
      assert.equal(audit?.userId, admin.id);
      assert.equal(audit?.actorType, 'PLATFORM_ADMIN');
      assert.equal(audit?.source, 'PLATFORM');
      const end = await fetch(url + '/super-admin/tenant-access/end', {
        method: 'POST', headers: { cookie: `${cookie}; ${clinicCookie}`, Origin: process.env.AUTH_ORIGIN! },
      });
      assert.equal(end.status, 200);
      assert.equal((await fetch(url + `/clinics/${a.tenant.id}`, { headers: { cookie: clinicCookie } })).status, 401);
      assert.ok(await db.authEvent.findFirst({ where: { tenantId: a.tenant.id, userId: admin.id, actorType: 'PLATFORM_ADMIN', source: 'PLATFORM', type: 'PLATFORM_TENANT_ACCESS_READ' } }));
      assert.ok(await db.authEvent.findFirst({ where: { tenantId: a.tenant.id, userId: admin.id, actorType: 'PLATFORM_ADMIN', source: 'PLATFORM', type: 'PLATFORM_TENANT_ACCESS_WRITE' } }));
      assert.ok(await db.authEvent.findFirst({ where: { tenantId: a.tenant.id, userId: admin.id, actorType: 'PLATFORM_ADMIN', type: 'PLATFORM_TENANT_ACCESS_STARTED' } }));
      assert.ok(await db.authEvent.findFirst({ where: { tenantId: a.tenant.id, userId: admin.id, actorType: 'PLATFORM_ADMIN', type: 'PLATFORM_TENANT_ACCESS_ENDED' } }));
    });
    await t.test('TASK-033: assinatura default, agregados isolados e mudança administrativa auditada', async () => {
      const initial = await db.tenantSubscription.findUnique({ where: { tenantId: a.tenant.id } });
      assert.equal(initial?.planCode, 'BASIC');
      assert.equal(initial?.status, 'ACTIVE');
      const before = await fetch(url + `/super-admin/tenants/${a.tenant.id}?period=CUSTOM&from=2026-10-15&to=2026-10-15`, { headers: { cookie } });
      assert.equal(before.status, 200);
      const overview = await before.json() as PlatformOverview;
      assert.equal(overview.clinics[0]?.plan?.code, 'BASIC');
      assert.equal(overview.clinics[0]?.plan?.keyMetrics.find((metric) => metric.metric === 'ACTIVE_USERS')?.value, 5);
      const change = await fetch(url + `/super-admin/tenants/${a.tenant.id}/subscription`, {
        method: 'PATCH', headers: { cookie, Origin: process.env.AUTH_ORIGIN!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ planCode: 'PRO', applyAt: 'NOW', status: 'ACTIVE' }),
      });
      assert.equal(change.status, 200);
      assert.equal(((await change.json()) as { planCode: string }).planCode, 'PRO');
      assert.equal((await db.tenantSubscription.findUnique({ where: { tenantId: b.tenant.id } }))?.planCode, 'BASIC');
      assert.ok(await db.authEvent.findFirst({ where: { tenantId: a.tenant.id, userId: admin.id, type: 'PLAN_CHANGED' } }));
      assert.ok(await db.authEvent.findFirst({ where: { tenantId: a.tenant.id, userId: admin.id, type: 'PLAN_UPGRADED' } }));
      const invalid = await fetch(url + `/super-admin/tenants/${a.tenant.id}/subscription`, {
        method: 'PATCH', headers: { cookie, Origin: process.env.AUTH_ORIGIN!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ planCode: 'PRO', tenantId: b.tenant.id }),
      });
      assert.equal(invalid.status, 400);
    });
    const params = `period=CUSTOM&from=2026-10-15&to=2026-10-15&search=${prefix}`;
    const get = (path: string, authCookie = cookie) =>
      fetch(url + '/super-admin/' + path, { headers: { cookie: authCookie } });
    await t.test(
      'E2E 1: A+B+C agregados, tokens e dados privados ausentes',
      async () => {
        const response = await get('overview?' + params);
        assert.equal(response.status, 200);
        const data = (await response.json()) as PlatformOverview;
        assert.deepEqual(data.summary, {
          tenants: 3,
          active: 2,
          suspended: 1,
          users: 10,
          conversations: 28,
          messages: 150,
          appointments: 15,
          tokens: 15000,
          units: 2,
          totalUsers: 10,
          aiRequests: 2,
          failedIntegrations: 2,
          tenantsWithIncidents: 1,
        });
        assert.equal(
          data.usage.reduce((n, r) => n + (r.inputTokens ?? 0), 0),
          7500,
        );
        assert.equal(
          data.usage.reduce((n, r) => n + (r.outputTokens ?? 0), 0),
          7500,
        );
        assert.ok(data.usage.every((r) => r.latencyMs === 100));
        assert.equal(data.period.timezone, 'UTC');
        assert.ok(data.incidents.some((r) => r.tenantId === b.tenant.id));
        assert.doesNotMatch(
          JSON.stringify(data),
          /PRIVATE_|content|password|credentialsReference/,
        );
        const limited = (await (
          await get('overview?' + params + '&limit=1')
        ).json()) as PlatformOverview;
        assert.equal(limited.clinics.length, 1);
        assert.equal(limited.clinics[0]!.id, a.tenant.id);
        const next = (await (
          await get('overview?' + params + '&limit=1&page=2')
        ).json()) as PlatformOverview;
        assert.equal(next.clinics[0]!.id, b.tenant.id);
        const active = (await (
          await get('overview?' + params + '&status=ACTIVE')
        ).json()) as PlatformOverview;
        assert.equal(active.summary.tenants, 2);
        const activity = (await (
          await get('overview?' + params + '&activeInPeriod=false')
        ).json()) as PlatformOverview;
        assert.equal(activity.summary.tenants, 1);
        const errors = (await (
          await get('overview?' + params + '&integrationStatus=ERROR')
        ).json()) as PlatformOverview;
        assert.equal(errors.summary.tenants, 1);
        const empty = (await (
          await get('overview?' + params.replace(prefix, '%27%20OR%201%3D1--'))
        ).json()) as PlatformOverview;
        assert.equal(empty.summary.tenants, 0);
        assert.equal(
          (await get('overview?period=CUSTOM&from=2020-01-01&to=2026-01-01'))
            .status,
          400,
        );
        assert.equal((await get('overview?limit=100000')).status, 400);
        assert.equal((await get('overview?platformScope=true')).status, 400);
      },
    );
    await t.test(
      'E2E 2: investigação de B auditada, isolada e sem credenciais',
      async () => {
        const res = await get(
          `tenants/${b.tenant.id}?${params.replace('&search=' + prefix, '')}`,
        );
        assert.equal(res.status, 200);
        const data = (await res.json()) as PlatformOverview;
        assert.equal(data.summary.messages, 50);
        assert.equal(data.summary.tokens, 5000);
        assert.equal(data.period.timezone, 'America/Sao_Paulo');
        assert.ok(
          data.integrations.every(
            (r) => r.tenantId === b.tenant.id && r.status === 'ERROR',
          ),
        );
        assert.ok(
          data.integrations.some((r) => r.errorCode === 'AUTHENTICATION'),
        );
        assert.doesNotMatch(JSON.stringify(data), /PRIVATE_/);
        assert.ok(!JSON.stringify(data).includes(a.tenant.id));
        const audit = await db.authEvent.findFirst({
          where: {
            type: 'PLATFORM_TENANT_VIEWED',
            tenantId: b.tenant.id,
            userId: admin.id,
          },
        });
        assert.ok(audit);
        assert.equal(audit.actorType, 'USER');
        assert.equal(audit.resourceId, b.tenant.id);
      },
    );
    await t.test(
      'E2E 3: usuários clínicos não obtêm escopo global',
      async () => {
        assert.equal((await get('overview', '')).status, 401);
        for (const role of ['CLINIC_ADMIN', 'AGENT', 'DOCTOR', 'SUPER_ADMIN']) {
          await db.userTenant.update({
            where: {
              userId_tenantId: { userId: a.userId, tenantId: a.tenant.id },
            },
            data: { role },
          });
          const clinical = randomBytes(32).toString('base64url');
          await db.authSession.create({
            data: {
              userId: a.userId,
              activeTenantId: a.tenant.id,
              tokenHash: tokenHash(clinical),
              expiresAt: new Date(Date.now() + 600000),
            },
          });
          assert.equal(
            (
              await get(
                'overview?platformScope=true',
                'atendente_session=' + clinical,
              )
            ).status,
            403,
          );
        }
        assert.equal(
          (await fetch(url + '/analytics/dashboard', { headers: { cookie } }))
            .status,
          401,
        );
        assert.equal(
          (
            await fetch(url + '/super-admin/logout', {
              method: 'POST',
              headers: { cookie },
            })
          ).status,
          403,
        );
      },
    );
    await t.test(
      'Login HTTP exige Origin, senha e MFA; consumo concorrente é único',
      async () => {
        const code = totp(secret, Math.floor(Date.now() / 30000) + 1);
        const body = JSON.stringify({ email: admin.email, password, code });
        const send = (origin: string) =>
          fetch(url + '/super-admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: origin },
            body,
          });
        assert.equal((await send('https://invalid.test')).status, 403);
        const responses = await Promise.all([
          send(process.env.AUTH_ORIGIN!),
          send(process.env.AUTH_ORIGIN!),
        ]);
        assert.deepEqual(responses.map((r) => r.status).sort(), [200, 401]);
        const success = responses.find((r) => r.status === 200)!;
        assert.match(success.headers.get('set-cookie')!, /HttpOnly/);
        assert.match(success.headers.get('set-cookie')!, /SameSite=Strict/);
        assert.doesNotMatch(await success.text(), /secret|token|password/i);
        // Two previous logins + two concurrent requests: the next invalid attempt is fifth.
        assert.equal((await send(process.env.AUTH_ORIGIN!)).status, 401);
        assert.equal((await send(process.env.AUTH_ORIGIN!)).status, 429);
      },
    );
    await t.test(
      'Revogação de concessão e sessão expirada bloqueiam imediatamente',
      async () => {
        await db.platformAdmin.update({
          where: { userId: admin.id },
          data: { active: false },
        });
        assert.equal((await get('overview')).status, 403);
        await db.platformAdmin.update({
          where: { userId: admin.id },
          data: { active: true },
        });
        await db.platformSession.update({
          where: { id: scope.sessionId },
          data: {
            verifiedAt: new Date(Date.now() - 20000),
            expiresAt: new Date(Date.now() - 1000),
          },
        });
        assert.equal((await get('overview')).status, 403);
      },
    );
    await t.test(
      'Convite, confirmação TOTP e anti-replay de enrollment',
      async () => {
        const user = await db.user.create({
          data: {
            name: 'Enrollment',
            email: randomUUID() + '@test.local',
            passwordHash: admin.passwordHash,
          },
        });
        const invite = randomBytes(32).toString('base64url');
        await db.platformAdmin.create({
          data: {
            userId: user.id,
            inviteHash: platformTokenHash(invite),
            inviteExpiresAt: new Date(Date.now() + 600000),
          },
        });
        const result = await auth.enroll(
          user.email,
          password,
          invite,
          'enrollment',
        );
        assert.ok('secret' in result && result.secret);
        await auth.enroll(
          user.email,
          password,
          invite,
          'enrollment',
          totp(result.secret!, Math.floor(Date.now() / 30000)),
        );
        const enrolled = await db.platformAdmin.findUniqueOrThrow({
          where: { userId: user.id },
        });
        assert.ok(enrolled.enrolledAt);
        assert.equal(enrolled.inviteHash, null);
        await assert.rejects(() =>
          auth.enroll(user.email, password, invite, 'enrollment'),
        );
        await assert.rejects(() =>
          auth.login(
            user.email,
            password,
            totp(result.secret!, Math.floor(Date.now() / 30000)),
            'enrollment',
          ),
        );
      },
    );
    await t.test(
      'Health conta filas sem payload; expiração do heartbeat e Redis indisponível',
      async () => {
        const redisUrl = process.env.TEST_REDIS_URL!;
        const queue = createHumanSlaQueue(redisUrl);
        const health = await platformHealth(redisUrl);
        assert.equal(health.redis, 'UP');
        assert.equal(health.worker, 'UNKNOWN');
        assert.equal(health.queues.length, 5);
        const before = health.queues.find((q) => q.name === 'human-sla')!;
        const waiting = await queue.add('platform-health-test', {
          tenantId: a.tenant.id,
          jobId: randomUUID(),
        });
        const delayed = await queue.add(
          'platform-health-test',
          { tenantId: a.tenant.id, jobId: randomUUID() },
          { delay: 3600000 },
        );
        const stop = startPlatformHeartbeat(redisUrl, {
          intervalMs: 100,
          ttlSeconds: 2,
        });
        try {
          let active = await platformHealth(redisUrl);
          const deadline = Date.now() + 1500;
          while (active.worker !== 'UP' && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            active = await platformHealth(redisUrl);
          }
          assert.equal(active.worker, 'UP');
          const counts = active.queues.find((q) => q.name === 'human-sla')!;
          assert.equal(counts.waiting, before.waiting + 1);
          assert.equal(counts.delayed, before.delayed + 1);
          assert.doesNotMatch(
            JSON.stringify(active),
            /password|PRIVATE|payload|redis:\/\//,
          );
          stop();
          await new Promise((resolve) => setTimeout(resolve, 2100));
          assert.equal(
            (await platformHealth(redisUrl)).worker,
            'UNKNOWN',
          );
          assert.equal(
            (await platformHealth('redis://127.0.0.1:1')).redis,
            'UNKNOWN',
          );
        } finally {
          stop();
          await waiting.remove();
          await delayed.remove();
          await queue.close();
        }
      },
    );
  } finally {
    await app.close();
    await db.$disconnect();
  }
});
