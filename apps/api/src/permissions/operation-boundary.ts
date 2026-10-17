import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@atendente/database';
import type { TenantScope } from '../tenancy/tenant.context';
/** Internal application boundary; never populated from HTTP headers/body or model code. */
export interface OperationBoundary {
  beforeWrite(tx: Prisma.TransactionClient, scope: TenantScope): Promise<void>;
  beforeCommit(): void;
}
export const operationBoundary = new AsyncLocalStorage<OperationBoundary>();
export async function checkOperation(
  tx: Prisma.TransactionClient,
  scope: TenantScope,
) {
  await operationBoundary.getStore()?.beforeWrite(tx, scope);
}
export function checkOperationDeadline() {
  operationBoundary.getStore()?.beforeCommit();
}
