import { recordAutomationAuditMany as recordAuditMany } from './audit';
import type { Prisma, PrismaClient } from './generated/prisma/client';

export async function databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  const [row] = await tx.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  return row!.now;
}
// Uso interno API/worker. Tenant é obrigatório; não é uma ferramenta pública.
export async function expireTenantHolds(
  tx: Prisma.TransactionClient,
  tenantId: string,
  now: Date,
  resource?: { providerId: string; unitId: string },
) {
  if (!tenantId) throw new Error('Tenant obrigatório.');
  const rows = await tx.appointmentHold.updateManyAndReturn({
    where: {
      tenantId,
      status: 'ACTIVE',
      expiresAt: { lte: now },
      ...(resource
        ? { providerId: resource.providerId, unitId: resource.unitId }
        : {}),
    },
    data: { status: 'EXPIRED' },
    select: { id: true },
  });
  if (rows.length)
    await recordAuditMany(tx, {
      data: rows.map((row) => ({
        type: 'HOLD_EXPIRED' as const,
        tenantId,
        resourceId: row.id,
        changes: { source: 'hold-expiration' },
      })),
    });
  return rows.length;
}
export async function sweepExpiredHolds(client: PrismaClient): Promise<number> {
  const now = await databaseNow(client);
  const tenants = await client.appointmentHold.findMany({
    where: { status: 'ACTIVE', expiresAt: { lte: now } },
    select: { tenantId: true },
    distinct: ['tenantId'],
    take: 100,
  });
  let count = 0;
  for (const { tenantId } of tenants)
    count += await client.$transaction(async (tx) =>
      expireTenantHolds(tx, tenantId, await databaseNow(tx)),
    );
  return count;
}
