import { createDatabaseClient } from './index';
import { assertDevelopmentSeed, seedDevelopment } from './development-seed';

async function main() {
  assertDevelopmentSeed(process.env.NODE_ENV);
  const client = createDatabaseClient(process.env.DATABASE_URL ?? '');
  try {
    await seedDevelopment(client, process.env.NODE_ENV);
    console.log('Seed de desenvolvimento concluído.');
  } finally {
    await client.$disconnect();
  }
}

main().catch(() => {
  console.error('Seed falhou. Verifique ambiente, conexão e migrations.');
  process.exitCode = 1;
});
