import { AuthorizationService } from '../src/permissions/authorization.service';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AuthRequest } from '../src/auth/auth.guard';
import type { DatabaseService } from '../src/auth/database.service';
import { TenantContext } from '../src/tenancy/tenant.context';
import { TenantRepository } from '../src/tenancy/tenant.repository';
import { UnitRepository } from '../src/units/unit.repository';
import {
  TenancyService,
  tenantSelection,
} from '../src/tenancy/tenancy.service';

const database = {} as DatabaseService;

test('services e repositories recusam chamadas sem identidade/tenant', async () => {
  for (const request of [
    {},
    {
      identity: { id: 'user', name: 'test', email: 'test@example.test' },
      sessionId: 'session',
    },
  ]) {
    const context = new TenantContext(request as AuthRequest, database);
    const authorization = new AuthorizationService(database, context);
    const tenants = new TenantRepository(database, context, authorization);
    const units = new UnitRepository(
      database,
      new AuthorizationService(database, context),
    );
    const service = new TenancyService(context, tenants, units, authorization);
    await assert.rejects(context.requireTenant());
    await assert.rejects(tenants.current());
    await assert.rejects(units.list());
    await assert.rejects(units.findById('resource'));
    await assert.rejects(service.current());
    await assert.rejects(service.listUnits());
    await assert.rejects(service.findUnit('resource'));
  }
});

test('seleção exige somente tenantId UUID, sem identidade/papel fornecidos', () => {
  for (const input of [
    undefined,
    {},
    [],
    { tenantId: 'outro' },
    { tenantId: '00000000-0000-4000-8000-000000000001', userId: 'outro' },
    { tenantId: '00000000-0000-4000-8000-000000000001', role: 'CLINIC_ADMIN' },
  ]) {
    assert.throws(() => tenantSelection(input));
  }
  assert.equal(
    tenantSelection({ tenantId: '00000000-0000-4000-8000-000000000001' }),
    '00000000-0000-4000-8000-000000000001',
  );
});
