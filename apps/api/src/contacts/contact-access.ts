import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import {
  AuthorizationService,
  authorizedTenantFilter,
} from '../permissions/authorization.service';
import type { TenantScope } from '../tenancy/tenant.context';

export const contactWhere = (
  scope: TenantScope,
  permission: 'contact.view' | 'contact.edit',
): Prisma.ContactWhereInput => ({
  tenantId: scope.tenantId,
  tenant: authorizedTenantFilter(scope, [permission]),
});

// O UPDATE do contato serializa também alterações concorrentes dos seus canais.
export async function lockContact(
  tx: Prisma.TransactionClient,
  scope: TenantScope,
  id: string,
) {
  const [contact] = await tx.contact.updateManyAndReturn({
    where: { id, ...contactWhere(scope, 'contact.edit') },
    data: { updatedAt: new Date() },
  });
  if (!contact) throw new NotFoundException('Contato não encontrado.');
  return contact;
}

@Injectable()
export class ContactAccess {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}
  async write<T>(
    execute: (tx: Prisma.TransactionClient, scope: TenantScope) => Promise<T>,
  ): Promise<T> {
    const scope = await this.authorization.requirePermissions('contact.edit');
    try {
      return await this.database.client.$transaction(
        async (tx) => {
          const tenant = await tx.tenant.findFirst({
            where: authorizedTenantFilter(scope, ['contact.edit']),
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
        ['P2002', 'P2034'].includes(String(error.code))
      )
        throw new ConflictException(
          'Canal já cadastrado ou alteração concorrente. Atualize e tente novamente.',
        );
      throw error;
    }
  }
}
