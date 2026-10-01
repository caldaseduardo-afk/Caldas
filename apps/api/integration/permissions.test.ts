import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  Controller,
  Get,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  createDatabaseClient,
  PERMISSIONS,
  type PermissionName,
} from '@atendente/database';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap';
import { AuthConfig } from '../src/auth/auth.config';
import { hashPassword } from '../src/auth/password';
import { tokenHash } from '../src/auth/auth.service';
import type { AuthRequest } from '../src/auth/auth.guard';
import type { DatabaseService } from '../src/auth/database.service';
import { TenantContext } from '../src/tenancy/tenant.context';
import { UnitRepository } from '../src/units/unit.repository';
import { TenantRepository } from '../src/tenancy/tenant.repository';
import { TenancyService } from '../src/tenancy/tenancy.service';
import { AuthorizationService } from '../src/permissions/authorization.service';
import { RequirePermissions } from '../src/permissions/permission.decorator';

// Endpoints de teste apenas: nenhuma funcionalidade futura entra no AppModule.
@Controller('rbac-probe')
class PermissionProbe {
  @Get('users') @RequirePermissions('user.manage') users() {
    return { allowed: true };
  }
  @Get('settings') @RequirePermissions('settings.manage') settings() {
    return { allowed: true };
  }
  @Get('billing') @RequirePermissions('billing.view') billing() {
    return { allowed: true };
  }
  @Get('both') @RequirePermissions('user.manage', 'settings.manage') both() {
    return { allowed: true };
  }
  @Get('missing') missing() {
    return { shouldNotRun: true };
  }
}
const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).pathname !== '/task002_test' ||
  connection !== process.env.DATABASE_URL
)
  throw new Error('Use pnpm db:test.');

test('RBAC com PostgreSQL: permissões, revogação e isolamento por tenant', async (t) => {
  const client = createDatabaseClient(connection);
  const module = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [PermissionProbe],
  }).compile();
  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });
  configureApplication(app, app.get(AuthConfig));
  try {
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const origin = process.env.AUTH_ORIGIN!;
    const tenantA = await client.tenant.create({
      data: { name: 'RBAC A', status: 'ACTIVE', timezone: 'UTC' },
    });
    const tenantB = await client.tenant.create({
      data: { name: 'RBAC B', status: 'ACTIVE', timezone: 'UTC' },
    });
    const unitA = await client.unit.create({
      data: { tenantId: tenantA.id, name: 'A', address: 'Fictício' },
    });
    const unitB = await client.unit.create({
      data: { tenantId: tenantB.id, name: 'B', address: 'Fictício' },
    });
    const password = 'senha longa teste rbac';
    const user = await client.user.create({
      data: {
        email: `${randomUUID()}@example.test`,
        name: 'RBAC',
        passwordHash: await hashPassword(password),
      },
    });
    await client.userTenant.createMany({
      data: [
        { userId: user.id, tenantId: tenantA.id, role: 'CLINIC_ADMIN' },
        { userId: user.id, tenantId: tenantB.id, role: 'DOCTOR' },
      ],
    });
    await client.authThrottle.deleteMany();
    const login = await fetch(`${url}/auth/login`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const get = (path: string, extra: Record<string, string> = {}) =>
      fetch(`${url}${path}`, { headers: { Cookie: cookie, ...extra } });
    const select = (tenantId: string) =>
      fetch(`${url}/tenancy/active`, {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: origin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tenantId }),
      });
    const stored = await client.authSession.findUniqueOrThrow({
      where: { tokenHash: tokenHash(cookie.split('=')[1]!) },
    });
    const database = { client } as DatabaseService;
    const makeAuthorization = (tenantId: string) =>
      new AuthorizationService(
        database,
        new TenantContext(
          {
            identity: { id: user.id, email: user.email, name: user.name },
            sessionId: stored.id,
            activeTenantId: tenantId,
          } as AuthRequest,
          database,
        ),
      );
    const role = (value: string) =>
      client.userTenant.update({
        where: { userId_tenantId: { userId: user.id, tenantId: tenantA.id } },
        data: { role: value },
      });

    await t.test(
      'HTTP: 401 sem sessão, 403 sem política; privilégio não atravessa tenant',
      async () => {
        assert.equal((await fetch(`${url}/rbac-probe/users`)).status, 401);
        assert.equal((await select(tenantA.id)).status, 200);
        for (const path of ['users', 'settings', 'billing', 'both'])
          assert.equal((await get(`/rbac-probe/${path}`)).status, 200);
        assert.equal((await get('/rbac-probe/missing')).status, 403);
        assert.equal((await get(`/tenancy/units/${unitA.id}`)).status, 200);
        assert.equal((await get(`/tenancy/units/${unitB.id}`)).status, 404);
        assert.equal((await select(tenantB.id)).status, 200);
        for (const path of ['users', 'settings', 'billing', 'both'])
          assert.equal((await get(`/rbac-probe/${path}`)).status, 403);
        assert.equal(
          (
            await get('/rbac-probe/users?role=CLINIC_ADMIN', {
              'X-Role': 'CLINIC_ADMIN',
              'X-Tenant-ID': tenantA.id,
              'X-Permissions': 'user.manage',
            })
          ).status,
          403,
        );
        assert.equal((await get(`/tenancy/units/${unitA.id}`)).status, 404);
        assert.equal((await get(`/tenancy/units/${unitB.id}`)).status, 200);
        assert.equal((await select(tenantA.id)).status, 200);
      },
    );

    await t.test(
      'matriz completa: autorização direta por papel no tenant ativo',
      async () => {
        const expected: Record<string, readonly PermissionName[]> = {
          CLINIC_ADMIN: PERMISSIONS,
          AGENT: [
            'tenant.view',
            'unit.view',
            'contact.view',
            'contact.edit',
            'conversation.view',
            'conversation.reply',
            'conversation.assign',
            'conversation.transfer',
            'conversation.close',
            'patient.view',
            'patient.edit',
            'appointment.view',
            'appointment.create',
            'appointment.reschedule',
            'appointment.cancel',
          ],
          DOCTOR: [
            'tenant.view',
            'unit.view',
            'patient.view',
            'appointment.view',
          ],
          SUPER_ADMIN: [],
          MANAGER: [],
        };
        for (const [name, permissions] of Object.entries(expected)) {
          await role(name);
          for (const permission of PERMISSIONS) {
            if (permissions.includes(permission))
              await makeAuthorization(tenantA.id).requirePermissions(
                permission,
              );
            else
              await assert.rejects(
                makeAuthorization(tenantA.id).requirePermissions(permission),
                ForbiddenException,
              );
          }
        }
        await role('CLINIC_ADMIN');
      },
    );

    await t.test(
      'revogação de permissão e troca de role valem sem novo login',
      async () => {
        await client.rolePermission.delete({
          where: {
            roleName_permissionName: {
              roleName: 'CLINIC_ADMIN',
              permissionName: 'settings.manage',
            },
          },
        });
        try {
          assert.equal((await get('/rbac-probe/users')).status, 200);
          assert.equal((await get('/rbac-probe/settings')).status, 403);
          assert.equal((await get('/rbac-probe/both')).status, 403);
        } finally {
          await client.rolePermission.create({
            data: {
              roleName: 'CLINIC_ADMIN',
              permissionName: 'settings.manage',
            },
          });
        }
        await role('DOCTOR');
        assert.equal((await get('/rbac-probe/users')).status, 403);
        await role('CLINIC_ADMIN');
        await client.role.update({
          where: { name: 'CLINIC_ADMIN' },
          data: { enabled: false },
        });
        try {
          assert.equal((await get('/tenancy/units')).status, 403);
        } finally {
          await client.role.update({
            where: { name: 'CLINIC_ADMIN' },
            data: { enabled: true },
          });
        }
      },
    );

    await t.test(
      'SUPER_ADMIN e roles desconhecidos não criam bypass nem com concessão no banco',
      async () => {
        await client.role.create({
          data: { name: 'LEGACY_TEST', enabled: true },
        });
        for (const name of ['SUPER_ADMIN', 'MANAGER', 'LEGACY_TEST']) {
          await client.role.update({
            where: { name },
            data: { enabled: true },
          });
          await client.rolePermission.create({
            data: { roleName: name, permissionName: 'unit.view' },
          });
          try {
            await role(name);
            assert.equal((await get('/tenancy/units')).status, 403);
            assert.equal((await get('/auth/me')).status, 200);
          } finally {
            await client.rolePermission.deleteMany({
              where: { roleName: name },
            });
            await client.role.update({
              where: { name },
              data: { enabled: false },
            });
          }
        }
        await role('CLINIC_ADMIN');
        await assert.rejects(role('NOT_REGISTERED'));
      },
    );

    await t.test(
      'services/repositories exigem permissão e query resiste à revogação posterior',
      async () => {
        const context = new TenantContext(
          {
            identity: { id: user.id, email: user.email, name: user.name },
            sessionId: stored.id,
            activeTenantId: tenantA.id,
          } as AuthRequest,
          database,
        );
        const authorization = new AuthorizationService(database, context);
        const units = new UnitRepository(database, authorization);
        const tenants = new TenantRepository(database, context, authorization);
        const service = new TenancyService(
          context,
          tenants,
          units,
          authorization,
        );
        const key = { roleName: 'CLINIC_ADMIN', permissionName: 'unit.view' };
        await client.rolePermission.delete({
          where: { roleName_permissionName: key },
        });
        try {
          await assert.rejects(service.listUnits(), ForbiddenException);
          await assert.rejects(units.list(), ForbiddenException);
          await assert.rejects(units.findById(unitA.id), ForbiddenException);
          assert.equal((await get('/tenancy/units')).status, 403);
        } finally {
          await client.rolePermission.create({ data: key });
        }
        const require = authorization.requirePermissions.bind(authorization);
        authorization.requirePermissions = async (...permissions) => {
          const scope = await require(...permissions);
          await client.rolePermission.delete({
            where: { roleName_permissionName: key },
          });
          return scope;
        };
        try {
          await assert.rejects(units.findById(unitA.id), NotFoundException);
        } finally {
          await client.rolePermission.create({ data: key });
        }
      },
    );
  } finally {
    await app.close();
    await client.$disconnect();
  }
});
