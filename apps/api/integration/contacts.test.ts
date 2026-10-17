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
import { ContactAccess } from '../src/contacts/contact-access';
import { ContactRepository } from '../src/contacts/contact.repository';
import { ContactChannelRepository } from '../src/contacts/contact-channel.repository';
import { ContactsService } from '../src/contacts/contacts.service';

const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).pathname !== '/task002_test' ||
  connection !== process.env.DATABASE_URL
)
  throw new Error('Use pnpm db:test.');
interface Channel {
  id: string;
  address: string;
  primary: boolean;
  providerExternalId: string | null;
  verifiedAt: string | null;
}
interface Contact {
  id: string;
  tenantId: string;
  displayName: string;
  status: string;
  channels: Channel[];
}

test('contatos/canais: normalização, duplicidade, principal e isolamento real', async (t) => {
  const client = createDatabaseClient(connection);
  const app = await createApplication();
  try {
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const origin = process.env.AUTH_ORIGIN!;
    const tenantA = await client.tenant.create({
      data: { name: 'Contatos A', status: 'ACTIVE', timezone: 'UTC' },
    });
    const tenantB = await client.tenant.create({
      data: { name: 'Contatos B', status: 'ACTIVE', timezone: 'UTC' },
    });
    const password = 'senha longa contato teste';
    const passwordHash = await hashPassword(password);
    const users: { id: string; email: string; name: string }[] = [];
    for (const [tenantId, role] of [
      [tenantA.id, 'AGENT'],
      [tenantB.id, 'CLINIC_ADMIN'],
      [tenantA.id, 'DOCTOR'],
    ])
      users.push(
        await client.user.create({
          data: {
            email: `${randomUUID()}@example.test`,
            name: role!,
            passwordHash,
            memberships: { create: { tenantId: tenantId!, role: role! } },
          },
        }),
      );
    await client.authThrottle.deleteMany();
    const request = (
      path: string,
      cookie = '',
      method = 'GET',
      body?: unknown,
      extra: Record<string, string> = {},
    ) =>
      fetch(`${url}${path}`, {
        method,
        headers: {
          Cookie: cookie,
          Origin: origin,
          'Content-Type': 'application/json',
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const login = async (index: number, tenantId: string) => {
      const response = await request('/auth/login', '', 'POST', {
        email: users[index]!.email,
        password,
      });
      assert.equal(response.status, 200);
      const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
      assert.equal(
        (await request('/tenancy/active', cookie, 'POST', { tenantId })).status,
        200,
      );
      return cookie;
    };
    const a = await login(0, tenantA.id),
      b = await login(1, tenantB.id),
      doctor = await login(2, tenantA.id);
    const find = async (id: string, cookie = a) =>
      (await (await request(`/contacts/${id}`, cookie)).json()) as Contact;
    const lookup = async (phone: string, cookie = a) =>
      (await (
        await request(`/contacts?${new URLSearchParams({ phone })}`, cookie)
      ).json()) as Contact[];
    const primary = (id: string) =>
      client.contactChannel.findMany({
        where: { tenantId: tenantA.id, contactId: id, primary: true },
      });
    let ca: Contact, cb: Contact, phoneId: string, whatsappId: string;

    await t.test(
      'três formatos encontram um contato; A e B cadastram o mesmo número',
      async () => {
        const payload = {
          displayName: 'Contato A',
          channels: [
            {
              type: 'PHONE',
              address: '(61) 99999-9999',
              providerExternalId: 'external-1',
            },
            { type: 'WHATSAPP', address: '+55 61 99999-9999' },
          ],
        };
        const responseA = await request('/contacts', a, 'POST', payload);
        assert.equal(responseA.status, 201);
        ca = (await responseA.json()) as Contact;
        phoneId = ca.channels.find(
          (channel) => channel.providerExternalId === 'external-1',
        )!.id;
        whatsappId = ca.channels.find((channel) => channel.id !== phoneId)!.id;
        assert.equal(ca.channels.length, 2);
        assert.equal(
          ca.channels.filter((channel) => channel.primary).length,
          1,
        );
        assert.ok(
          ca.channels.every(
            (channel) =>
              channel.address === '+5561999999999' &&
              channel.verifiedAt === null,
          ),
        );
        const responseB = await request('/contacts', b, 'POST', {
          ...payload,
          displayName: 'Segredo B',
        });
        assert.equal(responseB.status, 201);
        cb = (await responseB.json()) as Contact;
        for (const value of [
          '(61) 99999-9999',
          '61 99999-9999',
          '+55 61 99999-9999',
        ]) {
          assert.deepEqual(
            (await lookup(value)).map((contact) => contact.id),
            [ca.id],
          );
          assert.deepEqual(
            (await lookup(value, b)).map((contact) => contact.id),
            [cb.id],
          );
        }
        assert.equal((await find(ca.id)).tenantId, tenantA.id);
      },
    );
    await t.test(
      'duplicidade normalizada/external ID retorna 409 e não deixa contato órfão',
      async () => {
        const count = await client.contact.count({
          where: { tenantId: tenantA.id },
        });
        for (const address of ['61 99999-9999', '+55 61 99999-9999'])
          assert.equal(
            (
              await request('/contacts', a, 'POST', {
                displayName: 'Duplicado',
                channels: [{ type: 'PHONE', address }],
              })
            ).status,
            409,
          );
        assert.equal(
          (
            await request(`/contacts/${ca.id}/channels`, a, 'POST', {
              type: 'PHONE',
              address: '+5561999999999',
              primary: true,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await request(`/contacts/${ca.id}/channels`, a, 'POST', {
              type: 'PHONE',
              address: '(61) 98888-7777',
              providerExternalId: 'external-1',
            })
          ).status,
          409,
        );
        assert.equal(
          await client.contact.count({ where: { tenantId: tenantA.id } }),
          count,
        );
        assert.equal((await primary(ca.id))[0]!.id, phoneId);
      },
    );
    await t.test(
      'principal troca atomicamente; falha e concorrência preservam um principal',
      async () => {
        assert.equal(
          (
            await request(
              `/contacts/${ca.id}/channels/${whatsappId}`,
              a,
              'PATCH',
              { primary: true },
            )
          ).status,
          200,
        );
        assert.equal((await primary(ca.id))[0]!.id, whatsappId);
        assert.equal(
          (
            await request(
              `/contacts/${ca.id}/channels/${whatsappId}`,
              a,
              'PATCH',
              { primary: false },
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await request(`/contacts/${ca.id}/channels`, a, 'POST', {
              type: 'PHONE',
              address: '61999999999',
              primary: true,
            })
          ).status,
          409,
        );
        assert.equal((await primary(ca.id))[0]!.id, whatsappId);
        const responses = await Promise.all(
          [phoneId, whatsappId].map((id) =>
            request(`/contacts/${ca.id}/channels/${id}`, a, 'PATCH', {
              primary: true,
            }),
          ),
        );
        assert.ok(
          responses.every((response) => [200, 409].includes(response.status)),
        );
        assert.ok(responses.some((response) => response.status === 200));
        assert.equal((await primary(ca.id)).length, 1);
        const empty = await request('/contacts', a, 'POST', {
          displayName: 'Sem canal',
        });
        assert.equal(empty.status, 201);
        const emptyContact = (await empty.json()) as Contact;
        const first = await request(
          `/contacts/${emptyContact.id}/channels`,
          a,
          'POST',
          { type: 'PHONE', address: '61988887777', primary: false },
        );
        assert.equal(first.status, 201);
        assert.equal(((await first.json()) as Channel).primary, true);
        const second = await request(`/contacts/${ca.id}/channels`, a, 'POST', {
          type: 'PHONE',
          address: '61977776666',
        });
        assert.equal(second.status, 201);
        const secondary = (await second.json()) as Channel;
        assert.equal(
          (
            await request(
              `/contacts/${ca.id}/channels/${secondary.id}`,
              a,
              'PATCH',
              { address: '61 99999-9999', primary: true },
            )
          ).status,
          409,
        );
        assert.equal((await primary(ca.id)).length, 1);
      },
    );
    await t.test(
      'atualiza contato/canal; alteração de endereço limpa identidade externa antiga',
      async () => {
        assert.equal(
          (
            await request(`/contacts/${ca.id}`, a, 'PATCH', {
              displayName: 'Contato atualizado',
              status: 'INACTIVE',
            })
          ).status,
          200,
        );
        assert.equal((await find(ca.id)).displayName, 'Contato atualizado');
        assert.equal((await find(ca.id)).status, 'INACTIVE');
        await client.contactChannel.update({
          where: { id: phoneId },
          data: { verifiedAt: new Date() },
        });
        const updated = await request(
          `/contacts/${ca.id}/channels/${phoneId}`,
          a,
          'PATCH',
          { address: '(61) 96666-5555' },
        );
        assert.equal(updated.status, 200);
        const channel = (await updated.json()) as Channel;
        assert.equal(channel.address, '+5561966665555');
        assert.equal(channel.providerExternalId, null);
        assert.equal(channel.verifiedAt, null);
        assert.deepEqual(
          (await lookup('61 96666-5555')).map((contact) => contact.id),
          [ca.id],
        );
        assert.equal(
          (
            await request(
              `/contacts/${ca.id}/channels/${phoneId}`,
              a,
              'PATCH',
              { providerExternalId: 'new-id' },
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await request(
              `/contacts/${ca.id}/channels/${phoneId}`,
              a,
              'PATCH',
              { providerExternalId: null },
            )
          ).status,
          200,
        );
        const events = await client.authEvent.findMany({
          where: {
            tenantId: tenantA.id,
            type: {
              in: [
                'CONTACT_CREATED',
                'CONTACT_UPDATED',
                'CONTACT_CHANNEL_CREATED',
                'CONTACT_CHANNEL_UPDATED',
              ],
            },
          },
        });
        assert.ok(events.length >= 5);
        const changes = JSON.stringify(events.map((event) => event.changes));
        assert.ok(
          !changes.includes('+5561999999999') &&
            !changes.includes('+5561966665555') &&
            !changes.includes('Contato atualizado') &&
            !changes.includes('external-1'),
        );
      },
    );
    await t.test(
      'IDs de B, canal sob contato errado e telefone exclusivo não revelam dados a A',
      async () => {
        for (const [cookie, contact] of [
          [a, cb],
          [b, ca],
        ] as const) {
          assert.equal(
            (await request(`/contacts/${contact.id}`, cookie)).status,
            404,
          );
          assert.equal(
            (
              await request(`/contacts/${contact.id}`, cookie, 'PATCH', {
                displayName: 'Ataque',
              })
            ).status,
            404,
          );
          assert.equal(
            (
              await request(
                `/contacts/${contact.id}/channels`,
                cookie,
                'POST',
                { type: 'PHONE', address: '61912345678' },
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await request(
                `/contacts/${contact.id}/channels/${contact.channels[0]!.id}`,
                cookie,
                'PATCH',
                { primary: true },
              )
            ).status,
            404,
          );
        }
        assert.equal(
          (
            await request(
              `/contacts/${ca.id}/channels/${cb.channels[0]!.id}`,
              a,
              'PATCH',
              { primary: true },
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request('/contacts', b, 'POST', {
              displayName: 'Só B',
              channels: [{ type: 'PHONE', address: '61955554444' }],
            })
          ).status,
          201,
        );
        assert.deepEqual(await lookup('61955554444'), []);
        assert.equal(
          (
            await request(`/contacts/${cb.id}`, a, 'GET', undefined, {
              'X-Tenant-ID': tenantB.id,
            })
          ).status,
          404,
        );
        assert.equal((await find(cb.id, b)).displayName, 'Segredo B');
      },
    );
    await t.test(
      'DTOs, RBAC e CSRF; patient.view não autoriza acessar contatos',
      async () => {
        assert.equal((await request('/contacts')).status, 401);
        assert.equal((await request('/contacts', doctor)).status, 403);
        assert.equal(
          (
            await request('/contacts', doctor, 'POST', {
              displayName: 'Negado',
            })
          ).status,
          403,
        );
        for (const body of [
          {},
          { displayName: 'x', tenantId: tenantB.id },
          { displayName: 'x', channels: [{ type: 'EMAIL', address: 'x' }] },
          {
            displayName: 'x',
            channels: [
              { type: 'PHONE', address: '61911112222', primary: true },
              { type: 'WHATSAPP', address: '61911112222', primary: true },
            ],
          },
        ])
          assert.equal(
            (await request('/contacts', a, 'POST', body)).status,
            400,
          );
        assert.equal(
          (
            await request(`/contacts/${ca.id}`, a, 'PATCH', {
              tenantId: tenantB.id,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              `/contacts/${ca.id}/channels/${phoneId}`,
              a,
              'PATCH',
              { verifiedAt: new Date().toISOString() },
            )
          ).status,
          400,
        );
        assert.equal((await request('/contacts?phone=abc', a)).status, 400);
        assert.equal(
          (await request(`/contacts?tenantId=${tenantB.id}`, a)).status,
          400,
        );
        assert.equal((await request('/contacts/not-a-uuid', a)).status, 400);
        assert.equal(
          (
            await request(
              `/contacts/${ca.id}`,
              a,
              'PATCH',
              { displayName: 'CSRF' },
              { Origin: 'https://evil.test' },
            )
          ).status,
          403,
        );
        await client.rolePermission.delete({
          where: {
            roleName_permissionName: {
              roleName: 'AGENT',
              permissionName: 'contact.edit',
            },
          },
        });
        try {
          assert.equal((await request('/contacts', a)).status, 200);
          assert.equal(
            (
              await request(`/contacts/${ca.id}`, a, 'PATCH', {
                displayName: 'Negado',
              })
            ).status,
            403,
          );
        } finally {
          await client.rolePermission.create({
            data: { roleName: 'AGENT', permissionName: 'contact.edit' },
          });
        }
      },
    );
    await t.test(
      'constraints físicas: tenant composto, principal único e telefone canônico',
      async () => {
        await assert.rejects(
          client.contactChannel.create({
            data: {
              tenantId: tenantA.id,
              contactId: cb.id,
              type: 'PHONE',
              address: '+5561912345678',
            },
          }),
        );
        await assert.rejects(
          client.contactChannel.create({
            data: {
              tenantId: tenantA.id,
              contactId: ca.id,
              type: 'PHONE',
              address: '+5561912345678',
              primary: true,
            },
          }),
        );
        await assert.rejects(
          client.contactChannel.create({
            data: {
              tenantId: tenantA.id,
              contactId: ca.id,
              type: 'PHONE',
              address: '61912345678',
            },
          }),
        );
        await assert.rejects(
          client.contactChannel.create({
            data: {
              tenantId: tenantA.id,
              contactId: ca.id,
              type: 'WHATSAPP',
              address: '+5561999999999',
            },
          }),
        );
      },
    );
    await t.test(
      'cadastros concorrentes não duplicam canal nem deixam contato órfão',
      async () => {
        const before = await client.contact.count({
          where: { tenantId: tenantA.id },
        });
        const responses = await Promise.all(
          ['(61) 94444-3333', '+55 61 94444-3333'].map((address) =>
            request('/contacts', a, 'POST', {
              displayName: 'Concorrente',
              channels: [{ type: 'PHONE', address }],
            }),
          ),
        );
        assert.deepEqual(
          responses.map((response) => response.status).sort(),
          [201, 409],
        );
        assert.equal(
          await client.contact.count({ where: { tenantId: tenantA.id } }),
          before + 1,
        );
        const found = await lookup('61944443333');
        assert.equal(found.length, 1);
        assert.equal(
          found[0]!.channels.filter((channel) => channel.primary).length,
          1,
        );
      },
    );
    await t.test(
      'services/repositories negam ausência/revogação; falha de auditoria desfaz troca',
      async () => {
        const stored = await client.authSession.findUniqueOrThrow({
          where: { tokenHash: tokenHash(a.split('=')[1]!) },
        });
        const database = { client } as DatabaseService;
        const context = new TenantContext(
          {
            identity: {
              id: users[0]!.id,
              email: users[0]!.email,
              name: users[0]!.name,
            },
            sessionId: stored.id,
            activeTenantId: tenantA.id,
          } as AuthRequest,
          database,
        );
        const authorization = new AuthorizationService(database, context);
        const access = new ContactAccess(database, authorization);
        const original = authorization.requirePermissions.bind(authorization);
        authorization.requirePermissions = async (...permissions) => {
          const scope = await original(...permissions);
          await client.userTenant.update({
            where: {
              userId_tenantId: { userId: users[0]!.id, tenantId: tenantA.id },
            },
            data: { active: false },
          });
          return scope;
        };
        try {
          await assert.rejects(
            new ContactRepository(database, authorization, access).update(
              ca.id,
              { displayName: 'Negado' },
            ),
            ForbiddenException,
          );
        } finally {
          await client.userTenant.update({
            where: {
              userId_tenantId: { userId: users[0]!.id, tenantId: tenantA.id },
            },
            data: { active: true },
          });
          authorization.requirePermissions = original;
        }
        const failingDatabase = {
          client: {
            $transaction: (
              execute: (tx: Prisma.TransactionClient) => Promise<unknown>,
              options: { isolationLevel: 'Serializable' },
            ) =>
              client.$transaction(
                (tx) =>
                  execute(
                    new Proxy(tx, {
                      get(target, key) {
                        if (key === 'authEvent')
                          return {
                            create: async () => {
                              throw new Error('Auditoria indisponível');
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
        const previousPrimary = (await primary(ca.id))[0]!.id;
        await assert.rejects(
          new ContactChannelRepository(
            new ContactAccess(failingDatabase, authorization),
          ).update(ca.id, previousPrimary === phoneId ? whatsappId : phoneId, {
            primary: true,
          }),
        );
        assert.equal((await primary(ca.id))[0]!.id, previousPrimary);
        const empty = new AuthorizationService(
          database,
          new TenantContext({} as AuthRequest, database),
        );
        const repository = new ContactRepository(
          database,
          empty,
          new ContactAccess(database, empty),
        );
        await assert.rejects(repository.find(ca.id));
        await assert.rejects(
          new ContactsService(empty, repository).create({
            displayName: 'Negado',
          }),
        );
      },
    );
  } finally {
    await app.close();
    await client.$disconnect();
  }
});
