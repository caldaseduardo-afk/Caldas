import { createDatabaseClient } from './index';
import { seedRbac } from './rbac-seed';

async function main() {
  const client = createDatabaseClient(process.env.DATABASE_URL ?? '');
  try {
    await seedRbac(client);
    console.log(
      'Catálogo RBAC versionado aplicado. Nenhum vínculo de usuário alterado.',
    );
  } finally {
    await client.$disconnect();
  }
}
main().catch(() => {
  console.error('Seed RBAC falhou. Verifique conexão e migrations.');
  process.exitCode = 1;
});
