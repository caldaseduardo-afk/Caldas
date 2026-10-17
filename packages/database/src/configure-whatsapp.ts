import { recordAudit } from './audit';
import { createDatabaseClient, whatsappAccessToken } from './index';
async function main() {
  const tenantId = process.env.WHATSAPP_TENANT_ID ?? '',
    phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    externalAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? '',
    credentialsReference = process.env.WHATSAPP_CREDENTIALS_REFERENCE ?? '';
  const status = process.env.WHATSAPP_INTEGRATION_STATUS || 'ACTIVE';
  if (
    !/^[0-9a-f-]{36}$/i.test(tenantId) ||
    !/^[1-9]\d{4,31}$/.test(phoneNumberId) ||
    !/^[1-9]\d{4,31}$/.test(externalAccountId) ||
    !['ACTIVE', 'DISABLED'].includes(status)
  )
    throw new Error();
  whatsappAccessToken(credentialsReference);
  const client = createDatabaseClient(process.env.DATABASE_URL ?? '');
  try {
    await client.$transaction(
      async (tx) => {
        if (
          !(await tx.tenant.findFirst({
            where: { id: tenantId, status: 'ACTIVE' },
          }))
        )
          throw new Error();
        const existing = await tx.integration.findUnique({
          where: {
            provider_phoneNumberId: {
              provider: 'WHATSAPP_CLOUD',
              phoneNumberId,
            },
          },
        });
        if (
          existing &&
          (existing.tenantId !== tenantId ||
            existing.externalAccountId !== externalAccountId)
        )
          throw new Error();
        const row = existing
          ? await tx.integration.update({
              where: { id: existing.id, tenantId },
              data: {
                credentialsReference,
                status: status as 'ACTIVE' | 'DISABLED',
              },
            })
          : await tx.integration.create({
              data: {
                tenantId,
                phoneNumberId,
                externalAccountId,
                credentialsReference,
                status: status as 'ACTIVE' | 'DISABLED',
              },
            });
        await recordAudit(tx, {
          data: {
            tenantId,
            resourceId: row.id,
            type: 'INTEGRATION_CONFIGURED',
            changes: {
              source: 'operator-command',
              provider: 'WHATSAPP_CLOUD',
              status,
            },
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );
    console.info('Integração WhatsApp configurada.');
  } finally {
    await client.$disconnect();
  }
}
main().catch(() => {
  console.error(
    'Não foi possível configurar a integração. Verifique configuração e vínculo administrativo do número.',
  );
  process.exitCode = 1;
});
