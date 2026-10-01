import { createDatabaseClient } from '@atendente/database';
import { normalizeEmail } from './auth.input';
import { hashPassword } from './password';

async function main() {
  if (process.env.NODE_ENV !== 'development')
    throw new Error('Comando exclusivo de desenvolvimento.');
  const email = normalizeEmail(process.env.AUTH_BOOTSTRAP_EMAIL);
  const name = process.env.AUTH_BOOTSTRAP_NAME?.trim();
  if (!name || name.length > 200) throw new Error('Nome inválido.');
  const passwordHash = await hashPassword(
    process.env.AUTH_BOOTSTRAP_PASSWORD ?? '',
  );
  const client = createDatabaseClient(process.env.DATABASE_URL ?? '');
  try {
    await client.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, name, passwordHash },
      });
      await tx.authEvent.create({
        data: { type: 'USER_CREATED', userId: user.id },
      });
    });
    console.log(
      'Usuário de desenvolvimento criado, sem vínculos ou permissões de clínica.',
    );
  } finally {
    await client.$disconnect();
  }
}
main().catch(() => {
  console.error(
    'Falha ao criar usuário. Verifique ambiente, entradas e duplicidade de email.',
  );
  process.exitCode = 1;
});
