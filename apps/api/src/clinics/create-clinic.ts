import { createDatabaseClient } from '@atendente/database';
import { provisionDevelopmentClinic } from './development-provisioning';

async function main() {
  if (process.env.NODE_ENV !== 'development')
    throw new Error('Comando exclusivo de desenvolvimento.');
  const client = createDatabaseClient(process.env.DATABASE_URL ?? '');
  try {
    const clinic = await provisionDevelopmentClinic(
      client,
      process.env.NODE_ENV,
      process.env.CLINIC_OWNER_EMAIL,
      { name: process.env.CLINIC_NAME, timezone: process.env.CLINIC_TIMEZONE },
    );
    console.log(
      `Clínica criada: ${clinic.id}. Selecione-a explicitamente após login.`,
    );
  } finally {
    await client.$disconnect();
  }
}
main().catch(() => {
  console.error(
    'Falha no provisionamento. Verifique ambiente, dados, identidade e catálogo RBAC.',
  );
  process.exitCode = 1;
});
