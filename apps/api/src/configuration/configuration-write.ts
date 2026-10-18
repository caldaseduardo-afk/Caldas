import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import {
  AuthorizationService,
  authorizedTenantFilter,
} from '../permissions/authorization.service';
import type { TenantScope } from '../tenancy/tenant.context';

export async function configurationWrite<T>(
  database: DatabaseService,
  authorization: AuthorizationService,
  execute: (tx: Prisma.TransactionClient, scope: TenantScope) => Promise<T>,
): Promise<T> {
  const scope = await authorization.requirePermissions('settings.manage');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await database.client.$transaction(
        async (tx) => {
          const tenant = await tx.tenant.findFirst({
            where: authorizedTenantFilter(scope, ['settings.manage']),
            select: { id: true },
          });
          if (!tenant) throw new ForbiddenException('Permissão insuficiente.');
          return execute(tx, scope);
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2034' &&
        attempt < 2
      )
        continue;
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2034'
      )
        throw new ConflictException(
          'Configuração alterada simultaneamente. Tente novamente.',
        );
      throw error;
    }
  }
  throw new ConflictException('Configuração alterada simultaneamente. Tente novamente.');
}
