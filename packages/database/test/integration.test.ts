import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createDatabaseClient } from '../src';
import {
  DEVELOPMENT_TENANT_ID,
  DEVELOPMENT_UNIT_ID,
  seedDevelopment,
} from '../src/development-seed';

const connectionString = process.env.TEST_DATABASE_URL;
if (
  !connectionString ||
  new URL(connectionString).pathname !== '/task002_test'
) {
  throw new Error('Use pnpm db:test para executar em banco descartável.');
}

test('migration inicial, seed e constraints de tenant no PostgreSQL', async () => {
  const client = createDatabaseClient(connectionString);
  try {
    assert.equal(await client.tenant.count(), 1);
    assert.equal(await client.unit.count(), 1);
    const seeded = await client.unit.findUniqueOrThrow({
      where: {
        tenantId_id: {
          tenantId: DEVELOPMENT_TENANT_ID,
          id: DEVELOPMENT_UNIT_ID,
        },
      },
    });
    const tenant = await client.tenant.create({
      data: { name: 'Tenant B', status: 'ACTIVE', timezone: 'UTC' },
    });
    assert.match(
      tenant.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assert.ok(tenant.createdAt instanceof Date);
    assert.ok(tenant.updatedAt instanceof Date);
    // Verifica o padrão de consulta; não representa autorização/RLS ainda.
    assert.equal(
      await client.unit.findUnique({
        where: { tenantId_id: { tenantId: tenant.id, id: seeded.id } },
      }),
      null,
    );
    assert.equal(
      (await client.unit.findMany({ where: { tenantId: tenant.id } })).length,
      0,
    );
    assert.equal(
      (
        await client.unit.updateMany({
          where: { id: seeded.id, tenantId: tenant.id },
          data: { name: 'Não permitido' },
        })
      ).count,
      0,
    );
    await assert.rejects(
      client.unit.create({
        data: { tenantId: randomUUID(), name: 'Órfã', address: 'Teste' },
      }),
    );
    await assert.rejects(
      client.$executeRaw`INSERT INTO units (name, address) VALUES ('Sem tenant', 'Teste')`,
    );
    await assert.rejects(
      client.tenant.delete({ where: { id: DEVELOPMENT_TENANT_ID } }),
    );
    const changed = await client.unit.update({
      where: {
        tenantId_id: { tenantId: DEVELOPMENT_TENANT_ID, id: seeded.id },
      },
      data: { name: 'Nome alterado manualmente' },
    });
    assert.ok(changed.updatedAt.getTime() > seeded.updatedAt.getTime());
    assert.equal(changed.createdAt.getTime(), seeded.createdAt.getTime());
    await seedDevelopment(client, 'development');
    assert.equal(
      (
        await client.unit.findUniqueOrThrow({
          where: {
            tenantId_id: { tenantId: DEVELOPMENT_TENANT_ID, id: seeded.id },
          },
        })
      ).name,
      changed.name,
    );
    const columns = await client.$queryRaw<
      Array<{ column_name: string; data_type: string }>
    >`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'units' AND column_name IN ('id', 'tenant_id', 'created_at', 'updated_at')`;
    assert.deepEqual(
      Object.fromEntries(columns.map((c) => [c.column_name, c.data_type])),
      {
        id: 'uuid',
        tenant_id: 'uuid',
        created_at: 'timestamp with time zone',
        updated_at: 'timestamp with time zone',
      },
    );
  } finally {
    await client.$disconnect();
  }
});

test('catálogo RBAC: seed idempotente, associações e integridade referencial', async () => {
  const { seedRbac } = await import('../src/rbac-seed');
  const client = createDatabaseClient(connectionString);
  try {
    const snapshot = async () => ({
      roles: await client.role.findMany({ orderBy: { name: 'asc' } }),
      permissions: await client.permission.findMany({
        orderBy: { name: 'asc' },
      }),
      associations: await client.rolePermission.findMany({
        orderBy: [{ roleName: 'asc' }, { permissionName: 'asc' }],
      }),
      memberships: await client.userTenant.findMany({
        orderBy: [{ userId: 'asc' }, { tenantId: 'asc' }],
      }),
    });
    const before = await snapshot();
    await seedRbac(client);
    await seedRbac(client);
    assert.deepEqual(await snapshot(), before);
    assert.equal(before.permissions.length, 22);
    assert.deepEqual(
      before.roles.filter((r) => r.enabled).map((r) => r.name),
      ['AGENT', 'CLINIC_ADMIN', 'DOCTOR'],
    );
    assert.equal(
      before.associations.filter((r) => r.roleName === 'CLINIC_ADMIN').length,
      22,
    );
    assert.equal(
      before.associations.filter((r) => r.roleName === 'AGENT').length,
      15,
    );
    assert.equal(
      before.associations.filter((r) => r.roleName === 'DOCTOR').length,
      4,
    );
    assert.equal(
      before.associations.filter((r) =>
        ['SUPER_ADMIN', 'MANAGER'].includes(r.roleName),
      ).length,
      0,
    );
    await assert.rejects(
      client.rolePermission.create({
        data: { roleName: 'CLINIC_ADMIN', permissionName: 'inventada' },
      }),
    );
    await assert.rejects(
      client.rolePermission.create({
        data: { roleName: 'inventado', permissionName: 'user.manage' },
      }),
    );
  } finally {
    await client.$disconnect();
  }
});
