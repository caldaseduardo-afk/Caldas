import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createDatabaseClient } from '@atendente/database';
import { createApplication } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import type { InboxRepository } from '../src/inbox/inbox.repository';
type Page = Awaited<ReturnType<InboxRepository['list']>>;
type Detail = Awaited<ReturnType<InboxRepository['detail']>>;
type History = Awaited<ReturnType<InboxRepository['history']>>;
const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).pathname !== '/task002_test' ||
  connection !== process.env.DATABASE_URL
)
  throw new Error('Use pnpm db:test.');
test('Inbox: projections, busca, paginação e fronteiras de autorização', async (t) => {
  const client = createDatabaseClient(connection),
    app = await createApplication();
  try {
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
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
      data: {
        name: 'Inbox A',
        status: 'ACTIVE',
        timezone: 'America/Sao_Paulo',
      },
    });
    const tb = await client.tenant.create({
      data: { name: 'Inbox B', status: 'ACTIVE', timezone: 'UTC' },
    });
    const password = 'senha inbox longa de teste',
      passwordHash = await hashPassword(password);
    await client.authThrottle.deleteMany();
    async function login(tenantId: string, role: 'AGENT' | 'DOCTOR') {
      const user = await client.user.create({
        data: {
          email: `${randomUUID()}@inbox.test`,
          name: role === 'AGENT' ? 'Ana' : 'Médico',
          passwordHash,
          memberships: { create: { tenantId, role } },
        },
      });
      const response = await request('/auth/login', '', 'POST', {
        email: user.email,
        password,
      });
      assert.equal(response.status, 200);
      const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
      assert.equal(
        (await request('/tenancy/active', cookie, 'POST', { tenantId })).status,
        200,
      );
      return { user, cookie };
    }
    const a = await login(ta.id, 'AGENT'),
      b = await login(tb.id, 'AGENT'),
      doctor = await login(ta.id, 'DOCTOR');
    const foreignContact = await client.contact.create({
      data: { tenantId: tb.id, displayName: 'Segredo B' },
    });
    const foreign = await client.conversation.create({
      data: { tenantId: tb.id, contactId: foreignContact.id },
    });
    const conversations: { id: string; contactId: string }[] = [];
    for (const [index, status] of (
      [
        'AI_ACTIVE',
        'HUMAN_ACTIVE',
        'NEEDS_HUMAN',
        'WAITING_PATIENT',
        'RESOLVED',
        'CLOSED',
      ] as const
    ).entries()) {
      const contact = await client.contact.create({
        data: {
          tenantId: ta.id,
          displayName: `Pessoa ${index}`,
          channels: {
            create: {
              type: 'WHATSAPP',
              address: `+556199999999${index}`,
              primary: true,
            },
          },
        },
      });
      const conversation = await client.conversation.create({
        data: {
          tenantId: ta.id,
          contactId: contact.id,
          status,
          ...(status === 'HUMAN_ACTIVE'
            ? {
                assignedUserId: a.user.id,
                assignedAt: new Date(),
                handoffRequestedAt: new Date(),
              }
            : {}),
          ...(['RESOLVED', 'CLOSED'].includes(status)
            ? { resolvedAt: new Date() }
            : {}),
          ...(status === 'NEEDS_HUMAN'
            ? { handoffReason: 'OTHER', handoffRequestedAt: new Date() }
            : {}),
        },
      });
      conversations.push(conversation);
      for (let j = 0; j < 5; j++)
        await client.message.create({
          data: {
            tenantId: ta.id,
            conversationId: conversation.id,
            channel: 'WHATSAPP',
            senderType: 'USER',
            senderUserId: a.user.id,
            messageType: 'TEXT',
            content: `Pessoa ${index} mensagem ${j}`,
            createdAt: new Date(Date.UTC(2026, 0, index + 1, 12, j)),
          },
        });
    }
    const first = conversations[0]!;
    const patient = await client.patient.create({
      data: {
        tenantId: ta.id,
        name: 'Lucas',
        birthDate: new Date('2000-01-01'),
        notes: 'NÃO EXPOR',
      },
    });
    await client.contactPatient.create({
      data: {
        tenantId: ta.id,
        contactId: first.contactId,
        patientId: patient.id,
        relationshipType: 'MOTHER',
        relationshipStatus: 'VERIFIED',
        authorizationLevel: 'SCHEDULING_ONLY',
        authorizedAt: new Date(),
        authorizedBy: a.user.id,
      },
    });
    await client.conversation.update({
      where: { id: first.id },
      data: { activePatientId: patient.id },
    });
    const read = async <T = Awaited<ReturnType<InboxRepository['session']>>>(
      path: string,
      cookie = a.cookie,
    ): Promise<T> => {
      const r = await request(path, cookie);
      assert.equal(r.status, 200);
      return (await r.json()) as T;
    };
    await t.test(
      'sessão autorizada e bloqueio de usuário sem conversation.view',
      async () => {
        const s = await read('/inbox/session');
        assert.equal(s.tenant.id, ta.id);
        assert.equal(s.canReply, true);
        assert.equal(
          (await request('/inbox/session', doctor.cookie)).status,
          403,
        );
        assert.equal(
          (await request('/inbox/conversations', doctor.cookie)).status,
          403,
        );
        assert.equal((await request('/inbox/session')).status, 401);
      },
    );
    await t.test(
      'lista somente tenant atual, ordenação por última mensagem e paginação',
      async () => {
        const p: Page = await read('/inbox/conversations?limit=2');
        assert.equal(p.items.length, 2);
        assert.equal(p.hasMore, true);
        assert.equal(p.items[0]!.id, conversations[5]!.id);
        const p2: Page = await read('/inbox/conversations?limit=2&page=2');
        assert.equal(p2.items[0]!.id, conversations[3]!.id);
        const other: Page = await read('/inbox/conversations', b.cookie);
        assert.deepEqual(
          other.items.map((c) => c.id),
          [foreign.id],
        );
      },
    );
    for (const status of [
      'AI_ACTIVE',
      'HUMAN_ACTIVE',
      'NEEDS_HUMAN',
      'WAITING_PATIENT',
    ])
      await t.test(`filtro ${status} isolado`, async () => {
        const p: Page = await read(`/inbox/conversations?status=${status}`);
        assert.equal(p.items.length, 1);
        assert.equal(p.items[0]!.status, status);
        assert.notEqual(p.items[0]!.id, foreign.id);
      });
    await t.test(
      'busca antes da paginação por nome, telefone normalizado e paciente',
      async () => {
        for (const q of [
          'Pessoa 0',
          '(61) 99999-9990',
          '+55 61 99999-9990',
          'Lucas',
        ]) {
          const p: Page = await read(
            `/inbox/conversations?limit=1&q=${encodeURIComponent(q)}`,
          );
          assert.equal(p.items[0]!.id, first.id);
        }
        const p: Page = await read('/inbox/conversations?q=Segredo');
        assert.equal(p.items.length, 0);
      },
    );
    await t.test(
      'URL direta cross-tenant e cursor externo retornam 404',
      async () => {
        for (const path of [
          `/inbox/conversations/${foreign.id}`,
          `/inbox/conversations/${foreign.id}/messages`,
        ])
          assert.equal((await request(path, a.cookie)).status, 404);
        const foreignMessage = await client.message.findFirstOrThrow({
          where: { conversationId: conversations[1]!.id },
        });
        assert.equal(
          (
            await request(
              `/inbox/conversations/${first.id}/messages?before=${foreignMessage.id}`,
              a.cookie,
            )
          ).status,
          404,
        );
      },
    );
    await t.test(
      'histórico recente, anteriores sem duplicação, ordem e autoria',
      async () => {
        const p: History = await read(
          `/inbox/conversations/${first.id}/messages?limit=2`,
        );
        assert.deepEqual(
          p.items.map((m) => m.content),
          ['Pessoa 0 mensagem 3', 'Pessoa 0 mensagem 4'],
        );
        assert.equal(p.items[0]!.senderUser!.user.name, 'Ana');
        const older: History = await read(
          `/inbox/conversations/${first.id}/messages?limit=2&before=${p.before}`,
        );
        assert.deepEqual(
          older.items.map((m) => m.content),
          ['Pessoa 0 mensagem 1', 'Pessoa 0 mensagem 2'],
        );
        assert(!JSON.stringify(p).includes('senderUserId'));
      },
    );
    await t.test(
      'contexto mínimo, vínculo e paciente ativo; responsável',
      async () => {
        const d: Detail = await read(`/inbox/conversations/${first.id}`);
        assert.equal(d.activePatient?.name, 'Lucas');
        assert.equal(d.links[0]!.relationshipType, 'MOTHER');
        assert.equal(d.links[0]!.authorizationLevel, 'SCHEDULING_ONLY');
        assert(!JSON.stringify(d).includes('NÃO EXPOR'));
        assert(!JSON.stringify(d).includes('tenantId'));
        const assigned: Detail = await read(
          `/inbox/conversations/${conversations[1]!.id}`,
        );
        assert.equal(assigned.assignedUser?.user.name, 'Ana');
      },
    );
    await t.test(
      'próxima consulta mínima com timezone da unidade',
      async () => {
        const unit = await client.unit.create({
          data: {
            tenantId: ta.id,
            name: 'Centro',
            address: 'Rua',
            timezoneOverride: 'America/Manaus',
          },
        });
        const specialty = await client.specialty.create({
          data: { tenantId: ta.id, name: 'Geral' },
        });
        const service = await client.service.create({
          data: {
            tenantId: ta.id,
            specialtyId: specialty.id,
            name: 'Consulta',
            durationMinutes: 30,
          },
        });
        const provider = await client.provider.create({
          data: {
            tenantId: ta.id,
            name: 'Dra. Luiza',
            professionalType: 'DOCTOR',
          },
        });
        await client.providerService.create({
          data: {
            tenantId: ta.id,
            providerId: provider.id,
            serviceId: service.id,
          },
        });
        await client.providerUnit.create({
          data: { tenantId: ta.id, providerId: provider.id, unitId: unit.id },
        });
        await client.appointment.create({
          data: {
            tenantId: ta.id,
            patientId: patient.id,
            contactId: first.contactId,
            serviceId: service.id,
            providerId: provider.id,
            unitId: unit.id,
            createdByType: 'USER',
            createdById: a.user.id,
            startAt: new Date('2035-01-01T12:00:00Z'),
            endAt: new Date('2035-01-01T12:30:00Z'),
            occupiedStartAt: new Date('2035-01-01T12:00:00Z'),
            occupiedEndAt: new Date('2035-01-01T12:30:00Z'),
          },
        });
        const d: Detail = await read(`/inbox/conversations/${first.id}`);
        assert.equal(d.appointment?.timezone, 'America/Manaus');
        assert.equal(d.appointment?.provider, 'Dra. Luiza');
      },
    );
    await t.test(
      'revogar patient.view oculta projeção e busca; reply e appointment independentes',
      async () => {
        for (const permissionName of [
          'patient.view',
          'conversation.reply',
          'appointment.view',
        ])
          await client.rolePermission.delete({
            where: {
              roleName_permissionName: { roleName: 'AGENT', permissionName },
            },
          });
        try {
          const s = await read('/inbox/session');
          assert.equal(s.canViewPatients, false);
          assert.equal(s.canReply, false);
          const d: Detail = await read(`/inbox/conversations/${first.id}`);
          assert.equal(d.activePatient, null);
          assert.deepEqual(d.links, []);
          assert.equal(d.appointment, null);
          const p: Page = await read('/inbox/conversations?q=Lucas');
          assert.equal(p.items.length, 0);
          assert.equal(
            (
              await request(
                `/conversations/${first.id}/messages`,
                a.cookie,
                'POST',
                { messageType: 'TEXT', content: 'bloqueado' },
              )
            ).status,
            403,
          );
        } finally {
          for (const permissionName of [
            'patient.view',
            'conversation.reply',
            'appointment.view',
          ])
            await client.rolePermission.create({
              data: { roleName: 'AGENT', permissionName },
            });
        }
      },
    );
    await t.test(
      'DTO rejeita tenant arbitrário, query desconhecida e cursor inválido',
      async () => {
        for (const query of [
          `tenantId=${tb.id}`,
          'q=',
          'limit=101',
          'status=UNREAD',
          'page=0',
        ])
          assert.equal(
            (await request(`/inbox/conversations?${query}`, a.cookie)).status,
            400,
          );
        assert.equal(
          (
            await request(
              `/inbox/conversations/${first.id}/messages?before=invalid`,
              a.cookie,
            )
          ).status,
          400,
        );
      },
    );
  } finally {
    await app.close();
    await client.$disconnect();
  }
});
