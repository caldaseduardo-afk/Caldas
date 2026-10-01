import type { PrismaClient } from './generated/prisma/client';

export const DEVELOPMENT_TENANT_ID = '00000000-0000-4000-8000-000000000001';
export const DEVELOPMENT_UNIT_ID = '00000000-0000-4000-8000-000000000002';

export function assertDevelopmentSeed(environment: string | undefined) {
  if (environment !== 'development') {
    throw new Error('Seed permitido apenas com NODE_ENV=development.');
  }
}

export async function seedDevelopment(
  client: PrismaClient,
  environment: string | undefined,
) {
  assertDevelopmentSeed(environment);
  await client.$transaction(async (tx) => {
    await tx.tenant.upsert({
      where: { id: DEVELOPMENT_TENANT_ID },
      update: {},
      create: {
        id: DEVELOPMENT_TENANT_ID,
        name: 'Clínica de desenvolvimento',
        status: 'ACTIVE',
        timezone: 'America/Sao_Paulo',
      },
    });
    const existing = await tx.unit.findUnique({
      where: { id: DEVELOPMENT_UNIT_ID },
    });
    if (existing && existing.tenantId !== DEVELOPMENT_TENANT_ID) {
      throw new Error('ID reservado do seed pertence a outro tenant.');
    }
    await tx.unit.upsert({
      where: {
        tenantId_id: {
          tenantId: DEVELOPMENT_TENANT_ID,
          id: DEVELOPMENT_UNIT_ID,
        },
      },
      update: {},
      create: {
        id: DEVELOPMENT_UNIT_ID,
        tenantId: DEVELOPMENT_TENANT_ID,
        name: 'Unidade de desenvolvimento',
        address: 'Endereço fictício para desenvolvimento',
      },
    });
  });
}
