import type { PrismaClient } from './generated/prisma/client';
import {
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  OPERATIONAL_ROLES,
} from './rbac-catalog';

// Operação administrativa explícita: reaplica a política versionada, sem usuários/dados fictícios.
export async function seedRbac(client: PrismaClient) {
  await client.$transaction(async (tx) => {
    for (const name of PERMISSIONS)
      await tx.permission.upsert({
        where: { name },
        update: {},
        create: { name },
      });
    for (const name of ROLES) {
      const enabled = (OPERATIONAL_ROLES as readonly string[]).includes(name);
      await tx.role.upsert({
        where: { name },
        update: { enabled },
        create: { name, enabled },
      });
      const permissions = ROLE_PERMISSIONS[name];
      await tx.rolePermission.deleteMany({
        where: { roleName: name, permissionName: { notIn: [...permissions] } },
      });
      await tx.rolePermission.createMany({
        data: permissions.map((permissionName) => ({
          roleName: name,
          permissionName,
        })),
        skipDuplicates: true,
      });
    }
  });
}
