import { randomBytes } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { createDatabaseClient, recordAudit } from '@atendente/database';
import { platformTokenHash } from './platform-auth.service';
/** Local operational command only; no public grant/recovery endpoint. */
async function main() {
  const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const action = process.env.PLATFORM_ADMIN_ACTION;
  const actorId = process.env.PLATFORM_OPERATOR_USER_ID;
  const file = process.env.PLATFORM_INVITE_FILE;
  if (
    !email ||
    !actorId ||
    !['grant', 'revoke'].includes(action ?? '') ||
    (action === 'grant' && !file)
  )
    throw new Error('Arguments required');
  const client = createDatabaseClient(process.env.DATABASE_URL ?? '');
  const invite = randomBytes(32).toString('base64url');
  let written = false;
  try {
    if (action === 'grant') {
      await writeFile(file!, invite + '\n', { mode: 0o600, flag: 'wx' });
      written = true;
    }
    await client.$transaction(async (tx) => {
      const actor = await tx.user.findFirst({
        where: { id: actorId, status: 'ACTIVE' },
        select: { id: true },
      });
      const user = await tx.user.findFirst({
        where: { email, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!actor || !user) throw new Error('Identity unavailable');
      // Operator OS access is the bootstrap authority; audit records the explicit operator.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
      const data = {
        active: action === 'grant',
        encryptedSecret: null,
        enrolledAt: null,
        lastStep: -1n,
        inviteHash: action === 'grant' ? platformTokenHash(invite) : null,
        inviteExpiresAt:
          action === 'grant' ? new Date(Date.now() + 1800000) : null,
      };
      await tx.platformAdmin.upsert({
        where: { userId: user.id },
        create: { userId: user.id, ...data },
        update: data,
      });
      await tx.platformSession.deleteMany({ where: { userId: user.id } });
      await recordAudit(tx, {
        data: {
          type:
            action === 'grant'
              ? 'PLATFORM_ADMIN_GRANTED'
              : 'PLATFORM_ADMIN_REVOKED',
          userId: actor.id,
          resourceId: user.id,
        },
      });
    });
    console.log(
      action === 'grant'
        ? 'Convite criado no arquivo restrito indicado; validade 30 minutos. Entregue por canal seguro.'
        : 'Acesso e sessões revogados.',
    );
  } catch (error) {
    if (written) await unlink(file!).catch(() => undefined);
    throw error;
  } finally {
    await client.$disconnect();
  }
}
main().catch(() => {
  console.error(
    'Falha no provisionamento de plataforma. Verifique argumentos e identidades.',
  );
  process.exitCode = 1;
});
