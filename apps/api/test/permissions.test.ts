import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Controller,
  Get,
  ForbiddenException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '../src/permissions/permission.guard';
import {
  RequirePermissions,
  IdentityOnly,
} from '../src/permissions/permission.decorator';
import {
  AuthorizationService,
  authorizedTenantFilter,
} from '../src/permissions/authorization.service';
import { TenantOptional } from '../src/tenancy/tenant.guard';
import type { PermissionName } from '@atendente/database';

@RequirePermissions('user.manage')
@Controller()
class Administrative {
  @RequirePermissions('settings.manage')
  @Get()
  read() {}
}
class Identity {
  @IdentityOnly() read() {}
  @TenantOptional() missing() {}
}
function execution(
  controller: typeof Administrative | typeof Identity,
  handler: () => void,
) {
  return {
    getClass: () => controller,
    getHandler: () => handler,
  } as unknown as ExecutionContext;
}

test('guard exige todas as permissões da classe e do método; ausência de política nega', async () => {
  const calls: PermissionName[][] = [];
  const authorization = {
    requirePermissions: async (...permissions: PermissionName[]) => {
      calls.push(permissions);
    },
  } as unknown as AuthorizationService;
  const guard = new PermissionGuard(new Reflector(), authorization);
  assert.equal(
    await guard.canActivate(
      execution(Administrative, Administrative.prototype.read),
    ),
    true,
  );
  assert.deepEqual(calls, [['settings.manage', 'user.manage']]);
  assert.equal(
    await guard.canActivate(execution(Identity, Identity.prototype.read)),
    true,
  );
  await assert.rejects(
    guard.canActivate(execution(Identity, Identity.prototype.missing)),
    ForbiddenException,
  );
  authorization.requirePermissions = async () => {
    throw new ForbiddenException();
  };
  await assert.rejects(
    guard.canActivate(execution(Administrative, Administrative.prototype.read)),
    ForbiddenException,
  );
});

test('filtro rejeita política vazia ou permissão desconhecida', () => {
  const scope = { userId: 'user', sessionId: 'session', tenantId: 'tenant' };
  assert.throws(() => authorizedTenantFilter(scope, []), ForbiddenException);
  assert.throws(
    () => authorizedTenantFilter(scope, ['inventada' as PermissionName]),
    ForbiddenException,
  );
});
