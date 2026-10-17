import { recordAudit } from '@atendente/database';
import type { createDatabaseClient } from '@atendente/database';
import { normalizeEmail } from '../auth/auth.input';
import { createClinicDto } from './clinic.dto';

// Bootstrap local, fora de controllers e dos providers acessíveis à IA.
export async function provisionDevelopmentClinic(
  client: ReturnType<typeof createDatabaseClient>,
  environment: string | undefined,
  ownerEmail: unknown,
  body: unknown,
) {
  if (environment !== 'development')
    throw new Error('Provisionamento exclusivo de desenvolvimento.');
  const email = normalizeEmail(ownerEmail);
  const dto = createClinicDto(body);
  return client.$transaction(
    async (tx) => {
      const user = await tx.user.findFirst({
        where: {
          email,
          status: 'ACTIVE',
          mfaEnabled: false,
          mfaRequired: false,
        },
      });
      const role = await tx.role.findFirst({
        where: {
          name: 'CLINIC_ADMIN',
          enabled: true,
          permissions: { some: { permissionName: 'settings.manage' } },
        },
      });
      if (!user || !role)
        throw new Error('Identidade ou catálogo indisponível.');
      const tenant = await tx.tenant.create({
        data: {
          ...dto,
          status: 'ACTIVE',
          memberships: { create: { userId: user.id, role: 'CLINIC_ADMIN' } },
        },
      });
      await recordAudit(tx, {
        data: {
          type: 'TENANT_CREATED',
          tenantId: tenant.id,
          resourceId: tenant.id,
          changes: {
            source: 'development-provisioning',
            after: { ...dto, status: 'ACTIVE' },
          },
        },
      });
      await recordAudit(tx, {
        data: {
          type: 'TENANT_MEMBERSHIP_GRANTED',
          resourceId: user.id,
          tenantId: tenant.id,
          changes: { source: 'development-provisioning', role: 'CLINIC_ADMIN' },
        },
      });
      return tenant;
    },
    { isolationLevel: 'Serializable' },
  );
}
