import { recordAudit } from '@atendente/database';
import { createDatabaseClient } from '@atendente/database';
import { normalizeEmail } from '../auth/auth.input';
import { tenantSelection } from './tenancy.service';
import { assertHardPlanLimit } from '../plans/plan-usage';

async function main() {
  if (process.env.NODE_ENV !== 'development')
    throw new Error('Comando exclusivo de desenvolvimento.');
  const email = normalizeEmail(process.env.TENANCY_USER_EMAIL);
  const tenantId = tenantSelection({ tenantId: process.env.TENANCY_TENANT_ID });
  const client = createDatabaseClient(process.env.DATABASE_URL ?? '');
  try {
    await client.$transaction(async (tx) => {
      const user = await tx.user.findFirst({
        where: { email, status: 'ACTIVE' },
      });
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId, status: 'ACTIVE' },
      });
      if (!user || !tenant)
        throw new Error('Identidade ou tenant indisponível.');
      const existing = await tx.userTenant.findUnique({
        where: { userId_tenantId: { userId: user.id, tenantId } },
      });
      if (existing) {
        if (!existing.active)
          throw new Error(
            'Vínculo inativo não pode ser reativado por este comando.',
          );
        return;
      }
      await assertHardPlanLimit(tx, tenantId, 'maxUsers');
      await tx.userTenant.create({
        data: { userId: user.id, tenantId, role: 'AGENT' },
      });
      await recordAudit(tx, {
        data: {
          type: 'TENANT_MEMBERSHIP_GRANTED',
          resourceId: user.id,
          tenantId,
          newValues: { role: 'AGENT', active: true },
        },
      });
    });
    console.log(
      'Vínculo de desenvolvimento disponível. Nenhuma sessão foi selecionada automaticamente.',
    );
  } finally {
    await client.$disconnect();
  }
}

main().catch(() => {
  console.error(
    'Falha ao criar vínculo. Verifique ambiente, identidade, tenant e vínculo existente.',
  );
  process.exitCode = 1;
});
