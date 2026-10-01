import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { createDatabaseClient, type Prisma } from '@atendente/database';
import { createApplication } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { tokenHash } from '../src/auth/auth.service';
import type { AuthRequest } from '../src/auth/auth.guard';
import type { DatabaseService } from '../src/auth/database.service';
import { TenantContext } from '../src/tenancy/tenant.context';
import { AuthorizationService } from '../src/permissions/authorization.service';
import { PatientWrite } from '../src/patients/patient-access';
import { PatientRepository } from '../src/patients/patient.repository';
import { PatientsService } from '../src/patients/patients.service';
import { RelationshipRepository } from '../src/patients/relationship.repository';
import { PatientContactAccessRepository } from '../src/patients/patient-contact-access.repository';

const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).pathname !== '/task002_test' ||
  connection !== process.env.DATABASE_URL
)
  throw new Error('Use pnpm db:test.');
interface Patient {
  id: string;
  name: string;
  birthDate: string;
  document?: string | null;
  notes?: string | null;
}
interface Link {
  id: string;
  contactId: string;
  patientId: string;
  relationshipType: string;
  relationshipStatus: string;
  authorizationLevel: string;
  isPrimaryContact: boolean;
  legalRepresentative: boolean;
  active: boolean;
  authorizedAt: string | null;
  revokedAt: string | null;
}

test('pacientes e representantes: autorização, histórico e isolamento PostgreSQL', async (t) => {
  const client = createDatabaseClient(connection);
  const app = await createApplication();
  try {
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const tenantA = await client.tenant.create({
      data: { name: 'Pacientes A', status: 'ACTIVE', timezone: 'UTC' },
    });
    const tenantB = await client.tenant.create({
      data: { name: 'Pacientes B', status: 'ACTIVE', timezone: 'UTC' },
    });
    const password = 'senha longa paciente teste';
    const passwordHash = await hashPassword(password);
    const users: { id: string; email: string; name: string }[] = [];
    for (const [tenantId, role] of [
      [tenantA.id, 'CLINIC_ADMIN'],
      [tenantA.id, 'AGENT'],
      [tenantA.id, 'DOCTOR'],
      [tenantB.id, 'CLINIC_ADMIN'],
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
      extra: Record<string, string> = {},
    ) =>
      fetch(`${url}${path}`, {
        method,
        headers: {
          Cookie: cookie,
          Origin: process.env.AUTH_ORIGIN!,
          'Content-Type': 'application/json',
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    await client.authThrottle.deleteMany();
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
      agent = await login(1, tenantA.id),
      doctor = await login(2, tenantA.id),
      b = await login(3, tenantB.id);
    const createPatient = async (name: string, cookie = a) => {
      const response = await request('/patients', cookie, 'POST', {
        name,
        birthDate: '2000-02-29',
        document: 'DOCUMENTO PRIVADO',
        notes: 'NOTAS PRIVADAS',
      });
      assert.equal(response.status, 201, await response.clone().text());
      return (await response.json()) as Patient;
    };
    const createLink = async (
      patientId: string,
      contactId: string,
      body: Record<string, unknown> = {},
      cookie = a,
    ) => {
      const response = await request(
        `/patients/${patientId}/relationships`,
        cookie,
        'POST',
        { contactId, relationshipType: 'MOTHER', ...body },
      );
      assert.equal(response.status, 201, await response.clone().text());
      return (await response.json()) as Link;
    };
    const patchLink = (p: Patient, link: Link, body: unknown, cookie = a) =>
      request(
        `/patients/${p.id}/relationships/${link.id}`,
        cookie,
        'PATCH',
        body,
      );
    const context = (contactId: string, patientId: string, cookie = a) =>
      request(`/contacts/${contactId}/patients/${patientId}`, cookie);
    const links = async (patientId: string) =>
      (await (
        await request(`/patients/${patientId}/relationships`, a)
      ).json()) as Link[];
    const maria = await client.contact.create({
      data: { tenantId: tenantA.id, displayName: 'Maria' },
    });
    const pai = await client.contact.create({
      data: { tenantId: tenantA.id, displayName: 'Pai' },
    });
    const outsider = await client.contact.create({
      data: { tenantId: tenantB.id, displayName: 'Segredo B' },
    });
    let self: Patient, lucas: Patient, ana: Patient, foreign: Patient;
    let selfLink: Link,
      mother: Link,
      father: Link,
      anaLink: Link,
      foreignLink: Link;

    await t.test(
      'Contact separado de Patient, SELF e N:N sem duplicar contato',
      async () => {
        const count = await client.contact.count();
        self = await createPatient('Maria');
        lucas = await createPatient('Lucas');
        ana = await createPatient('Ana');
        foreign = await createPatient('Segredo B', b);
        selfLink = await createLink(self.id, maria.id, {
          relationshipType: 'SELF',
        });
        mother = await createLink(lucas.id, maria.id, {
          isPrimaryContact: true,
        });
        father = await createLink(lucas.id, pai.id, {
          relationshipType: 'FATHER',
        });
        anaLink = await createLink(ana.id, maria.id);
        foreignLink = await createLink(foreign.id, outsider.id, {}, b);
        assert.notEqual(self.id, maria.id);
        assert.equal(selfLink.relationshipType, 'SELF');
        assert.equal(await client.contact.count(), count);
        const contactLinks = (await (
          await request(`/contacts/${maria.id}/patient-links`, a)
        ).json()) as Link[];
        assert.deepEqual(
          contactLinks.map((x) => x.patientId).sort(),
          [self.id, lucas.id, ana.id].sort(),
        );
        assert.equal((await links(lucas.id)).length, 2);
        assert.equal(mother.relationshipStatus, 'DECLARED');
        assert.equal(mother.authorizationLevel, 'NO_ACCESS');
        assert.equal(mother.authorizedAt, null);
      },
    );
    await t.test(
      'consulta e atualização administrativa; responses com projeções mínimas',
      async () => {
        const list = (await (
          await request('/patients', a)
        ).json()) as Patient[];
        assert.equal(list.length, 3);
        assert.deepEqual(Object.keys(list[0]!).sort(), [
          'birthDate',
          'id',
          'name',
        ]);
        assert.equal(
          (await request(`/patients/${lucas.id}`, doctor)).status,
          200,
        );
        assert.equal(
          (
            await request(`/patients/${lucas.id}`, agent, 'PATCH', {
              name: 'Lucas atualizado',
              healthPlan: 'Plano',
              paymentPreference: 'Particular',
              notes: null,
            })
          ).status,
          200,
        );
        const details = (await (
          await request(`/patients/${lucas.id}`, a)
        ).json()) as Patient;
        assert.equal(details.name, 'Lucas atualizado');
        assert.equal(details.notes, null);
        assert.deepEqual(Object.keys(details).sort(), [
          'birthDate',
          'document',
          'healthPlan',
          'id',
          'name',
          'notes',
          'paymentPreference',
        ]);
        assert.deepEqual(Object.keys(mother).sort(), [
          'active',
          'authorizationLevel',
          'authorizedAt',
          'contactId',
          'id',
          'isPrimaryContact',
          'legalRepresentative',
          'patientId',
          'relationshipStatus',
          'relationshipType',
          'revokedAt',
        ]);
      },
    );
    await t.test(
      'NO_ACCESS, SCHEDULING_ONLY e DECLARED não liberam leitura pelo contato',
      async () => {
        assert.equal((await context(maria.id, lucas.id)).status, 404);
        assert.equal((await context(maria.id, self.id)).status, 404);
        for (const body of [
          {
            relationshipStatus: 'DECLARED',
            authorizationLevel: 'SCHEDULING_ONLY',
            legalRepresentative: true,
          },
          { relationshipStatus: 'DECLARED', authorizationLevel: 'FULL' },
          { relationshipStatus: 'VERIFIED', authorizationLevel: 'NO_ACCESS' },
          {
            relationshipStatus: 'VERIFIED',
            authorizationLevel: 'SCHEDULING_ONLY',
          },
        ]) {
          const response = await patchLink(lucas, mother, body);
          assert.equal(response.status, 200);
          const link = (await response.json()) as Link;
          assert.equal(link.relationshipStatus, body.relationshipStatus);
          assert.equal(link.authorizationLevel, body.authorizationLevel);
          assert.equal((await context(maria.id, lucas.id)).status, 404);
        }
        assert.equal(
          (
            await patchLink(lucas, mother, {
              relationshipStatus: 'VERIFIED',
              authorizationLevel: 'FULL',
            })
          ).status,
          200,
        );
        const response = await context(maria.id, lucas.id);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          id: lucas.id,
          name: 'Lucas atualizado',
          birthDate: '2000-02-29',
        });
        assert.equal((await context(pai.id, lucas.id)).status, 404);
        await client.contact.update({
          where: { id: maria.id },
          data: { status: 'INACTIVE' },
        });
        assert.equal((await context(maria.id, lucas.id)).status, 404);
        await client.contact.update({
          where: { id: maria.id },
          data: { status: 'ACTIVE' },
        });
      },
    );
    await t.test(
      'backend exige patient.authorize; AGENT não verifica nem concede autorização',
      async () => {
        for (const body of [
          { relationshipStatus: 'VERIFIED' },
          { authorizationLevel: 'FULL' },
          { authorizationLevel: 'SCHEDULING_ONLY' },
          { legalRepresentative: true },
        ]) {
          assert.equal(
            (await patchLink(lucas, mother, body, agent)).status,
            403,
          );
          assert.equal(
            (
              await request(
                `/patients/${ana.id}/relationships`,
                agent,
                'POST',
                { contactId: pai.id, relationshipType: 'FATHER', ...body },
              )
            ).status,
            403,
          );
        }
        assert.equal(
          (
            await patchLink(
              lucas,
              mother,
              { relationshipType: 'CAREGIVER' },
              agent,
            )
          ).status,
          200,
        );
        const reset = (await links(lucas.id)).find((x) => x.id === mother.id)!;
        assert.equal(reset.relationshipStatus, 'DECLARED');
        assert.equal(reset.authorizationLevel, 'NO_ACCESS');
        assert.equal(reset.legalRepresentative, false);
        assert.equal((await context(maria.id, lucas.id)).status, 404);
        assert.equal((await request('/patients')).status, 401);
        assert.equal(
          (
            await request('/patients', doctor, 'POST', {
              name: 'Negado',
              birthDate: '2000-01-01',
            })
          ).status,
          403,
        );
        assert.equal((await context(maria.id, lucas.id, doctor)).status, 403);
        assert.equal(
          (await request(`/patients/${lucas.id}/relationships`, doctor)).status,
          403,
        );
      },
    );
    await t.test(
      'IDs de outro tenant: leitura, alteração e vínculo retornam mesmo 404 de inexistente',
      async () => {
        for (const id of [foreign.id, randomUUID()]) {
          const response = await request(`/patients/${id}`, a);
          assert.equal(response.status, 404);
          assert.equal(
            ((await response.json()) as { message: string }).message,
            'Paciente não encontrado.',
          );
          assert.equal(
            (await request(`/patients/${id}`, a, 'PATCH', { name: 'Ataque' }))
              .status,
            404,
          );
          assert.equal(
            (await request(`/patients/${id}/relationships`, a)).status,
            404,
          );
          assert.equal(
            (
              await request(`/patients/${id}/relationships`, a, 'POST', {
                contactId: maria.id,
                relationshipType: 'SELF',
              })
            ).status,
            404,
          );
        }
        for (const id of [outsider.id, randomUUID()]) {
          assert.equal(
            (
              await request(`/patients/${lucas.id}/relationships`, a, 'POST', {
                contactId: id,
                relationshipType: 'SELF',
              })
            ).status,
            404,
          );
          assert.equal(
            (await request(`/contacts/${id}/patient-links`, a)).status,
            404,
          );
          const response = await context(id, lucas.id);
          assert.equal(response.status, 404);
          assert.equal(
            ((await response.json()) as { message: string }).message,
            'Paciente indisponível para este contato.',
          );
        }
        assert.equal(
          (await patchLink(lucas, foreignLink, { isPrimaryContact: true }))
            .status,
          404,
        );
        assert.equal(
          (
            await request(
              `/patients/${lucas.id}/relationships/${foreignLink.id}/revoke`,
              a,
              'POST',
            )
          ).status,
          404,
        );
        assert.equal((await context(maria.id, foreign.id)).status, 404);
        assert.equal((await context(outsider.id, foreign.id)).status, 404);
        assert.equal(
          (
            await request(`/patients/${foreign.id}`, a, 'GET', undefined, {
              'X-Tenant-ID': tenantB.id,
            })
          ).status,
          404,
        );
        assert.equal((await request(`/patients/${lucas.id}`, b)).status, 404);
        assert.equal((await request(`/patients/${foreign.id}`, b)).status, 200);
      },
    );
    await t.test(
      'principal troca atomicamente; duplicidade e concorrência preservam unicidade',
      async () => {
        assert.equal(
          (await patchLink(lucas, father, { isPrimaryContact: true }, agent))
            .status,
          200,
        );
        assert.deepEqual(
          (await links(lucas.id))
            .filter((x) => x.isPrimaryContact)
            .map((x) => x.id),
          [father.id],
        );
        assert.equal(
          (
            await request(`/patients/${lucas.id}/relationships`, a, 'POST', {
              contactId: maria.id,
              relationshipType: 'MOTHER',
              isPrimaryContact: true,
            })
          ).status,
          409,
        );
        assert.deepEqual(
          (await links(lucas.id))
            .filter((x) => x.isPrimaryContact)
            .map((x) => x.id),
          [father.id],
        );
        const results = await Promise.all(
          [mother, father].map((link) =>
            patchLink(lucas, link, { isPrimaryContact: true }),
          ),
        );
        assert.ok(results.every((r) => [200, 409].includes(r.status)));
        assert.ok(results.some((r) => r.status === 200));
        assert.equal(
          (await links(lucas.id)).filter((x) => x.isPrimaryContact).length,
          1,
        );
      },
    );
    await t.test(
      'revogação bloqueia novos acessos, registra atores e preserva histórico',
      async () => {
        assert.equal(
          (
            await patchLink(lucas, mother, {
              relationshipStatus: 'VERIFIED',
              authorizationLevel: 'FULL',
              isPrimaryContact: true,
            })
          ).status,
          200,
        );
        assert.equal((await context(maria.id, lucas.id)).status, 200);
        const revokePath = `/patients/${lucas.id}/relationships/${mother.id}/revoke`;
        for (let i = 0; i < 2; i++)
          assert.equal((await request(revokePath, agent, 'POST')).status, 200);
        assert.equal((await context(maria.id, lucas.id)).status, 404);
        const history = (await links(lucas.id)).find(
          (x) => x.id === mother.id,
        )!;
        assert.equal(history.relationshipStatus, 'REVOKED');
        assert.equal(history.active, false);
        assert.equal(history.authorizationLevel, 'NO_ACCESS');
        assert.ok(history.revokedAt);
        assert.equal(
          (await links(lucas.id)).filter((x) => x.isPrimaryContact).length,
          0,
        );
        const stored = await client.contactPatient.findUniqueOrThrow({
          where: { id: mother.id },
        });
        assert.equal(stored.authorizedBy, users[0]!.id);
        assert.equal(stored.revokedBy, users[1]!.id);
        assert.equal(
          await client.authEvent.count({
            where: { resourceId: mother.id, type: 'CONTACT_PATIENT_REVOKED' },
          }),
          1,
        );
        assert.equal(
          (await patchLink(lucas, mother, { relationshipStatus: 'VERIFIED' }))
            .status,
          409,
        );
        assert.equal(
          (
            await request(`/patients/${lucas.id}/relationships`, a, 'POST', {
              contactId: maria.id,
              relationshipType: 'MOTHER',
            })
          ).status,
          409,
        );
        const events = await client.authEvent.findMany({
          where: {
            tenantId: tenantA.id,
            type: {
              in: [
                'PATIENT_CREATED',
                'PATIENT_UPDATED',
                'CONTACT_PATIENT_CREATED',
                'CONTACT_PATIENT_UPDATED',
                'CONTACT_PATIENT_REVOKED',
              ],
            },
          },
        });
        assert.ok(events.length > 10);
        const audit = JSON.stringify(events.map((x) => x.changes));
        for (const secret of [
          'DOCUMENTO PRIVADO',
          'NOTAS PRIVADAS',
          'Lucas atualizado',
        ])
          assert.ok(!audit.includes(secret));
      },
    );
    await t.test(
      'DTOs e CSRF impedem alteração de tenant, autoria e campos internos',
      async () => {
        for (const body of [
          { tenantId: tenantB.id },
          { authorizedBy: users[0]!.id },
          { revokedAt: new Date().toISOString() },
          { active: false },
          { authorizationLevel: ['FULL'] },
          { relationshipStatus: 'REVOKED' },
        ])
          assert.equal((await patchLink(ana, anaLink, body)).status, 400);
        assert.equal(
          (
            await request(`/patients/${ana.id}`, a, 'PATCH', {
              tenantId: tenantB.id,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request('/patients', a, 'POST', {
              name: 'Inválido',
              birthDate: '2023-02-29',
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              `/patients/${ana.id}`,
              a,
              'PATCH',
              { name: 'CSRF' },
              { Origin: 'https://evil.test' },
            )
          ).status,
          403,
        );
        assert.equal((await request('/patients/not-a-uuid', a)).status, 400);
      },
    );
    await t.test(
      'constraints físicas impedem relações cruzadas, principal duplicado e revogação inconsistente',
      async () => {
        const base = {
          tenantId: tenantA.id,
          contactId: pai.id,
          patientId: ana.id,
          relationshipType: 'FATHER' as const,
        };
        for (const data of [
          { ...base, contactId: outsider.id },
          { ...base, patientId: foreign.id },
          { ...base, authorizedBy: users[3]!.id, authorizedAt: new Date() },
          { ...base, authorizationLevel: 'FULL' as const },
          { ...base, relationshipStatus: 'REVOKED' as const },
          { ...base, authorizedBy: users[0]!.id },
        ])
          await assert.rejects(client.contactPatient.create({ data }));
        assert.equal(
          (await patchLink(lucas, father, { isPrimaryContact: true })).status,
          200,
        );
        const third = await client.contact.create({
          data: { tenantId: tenantA.id, displayName: 'Terceiro' },
        });
        await assert.rejects(
          client.contactPatient.create({
            data: {
              ...base,
              patientId: lucas.id,
              contactId: third.id,
              isPrimaryContact: true,
            },
          }),
        );
        await assert.rejects(
          client.contactPatient.create({
            data: { ...base, contactId: maria.id },
          }),
        );
        assert.equal(
          await client.patient.count({
            where: {
              document: 'DOCUMENTO PRIVADO',
              tenantId: { in: [tenantA.id, tenantB.id] },
            },
          }),
          4,
        );
      },
    );
    await t.test(
      'revalidação no SQL após revogação do vínculo ou membership e rollback da auditoria',
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
              activeTenantId: tenantA.id,
            } as AuthRequest,
            database,
          ),
        );
        const original = auth.requirePermissions.bind(auth);
        assert.equal(
          (
            await patchLink(ana, anaLink, {
              relationshipStatus: 'VERIFIED',
              authorizationLevel: 'FULL',
            })
          ).status,
          200,
        );
        auth.requirePermissions = async (...permissions) => {
          const scope = await original(...permissions);
          await client.contactPatient.update({
            where: { id: anaLink.id },
            data: {
              relationshipStatus: 'REVOKED',
              authorizationLevel: 'NO_ACCESS',
              active: false,
              isPrimaryContact: false,
              revokedBy: users[0]!.id,
              revokedAt: new Date(),
            },
          });
          return scope;
        };
        await assert.rejects(
          new PatientContactAccessRepository(database, auth).find(
            maria.id,
            ana.id,
          ),
          NotFoundException,
        );
        auth.requirePermissions = async (...permissions) => {
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
            new PatientRepository(
              database,
              auth,
              new PatientWrite(database, auth),
            ).update(ana.id, { name: 'Negado' }),
            ForbiddenException,
          );
        } finally {
          await client.userTenant.update({
            where: {
              userId_tenantId: { userId: users[0]!.id, tenantId: tenantA.id },
            },
            data: { active: true },
          });
          auth.requirePermissions = original;
        }
        const second = await createLink(self.id, pai.id, {
          relationshipType: 'OTHER',
          isPrimaryContact: true,
        });
        const failing = {
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
        await assert.rejects(
          new RelationshipRepository(
            failing,
            auth,
            new PatientWrite(failing, auth),
          ).update(self.id, selfLink.id, { isPrimaryContact: true }),
        );
        assert.deepEqual(
          (await links(self.id))
            .filter((x) => x.isPrimaryContact)
            .map((x) => x.id),
          [second.id],
        );
        const empty = new AuthorizationService(
          database,
          new TenantContext({} as AuthRequest, database),
        );
        const repository = new PatientRepository(
          database,
          empty,
          new PatientWrite(database, empty),
        );
        await assert.rejects(repository.find(ana.id));
        await assert.rejects(
          new PatientsService(empty, repository).create({
            name: 'Negado',
            birthDate: '2000-01-01',
          }),
        );
        await assert.rejects(
          new PatientContactAccessRepository(database, empty).find(
            maria.id,
            self.id,
          ),
        );
      },
    );
  } finally {
    await app.close();
    await client.$disconnect();
  }
});
