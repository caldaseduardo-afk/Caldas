import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  ForbiddenException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, recordAudit } from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import { AuthConfig } from '../auth/auth.config';
import { PasswordBusyError, verifyPassword } from '../auth/password';
import {
  decryptSecret,
  encryptSecret,
  encodeSecret,
  verifyTotp,
} from './platform-totp';

export interface PlatformScope {
  userId: string;
  sessionId: string;
}
export const platformTokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** Dedicated grant + MFA session. No UserTenant role or client-provided scope is trusted. */
export async function requirePlatform(
  tx: Prisma.TransactionClient,
  scope: PlatformScope,
) {
  const session = await tx.platformSession.findFirst({
    where: {
      id: scope.sessionId,
      userId: scope.userId,
      expiresAt: { gt: new Date() },
    },
    include: { user: { include: { platformAdmin: true } } },
  });
  const grant = session?.user.platformAdmin;
  if (
    !session ||
    session.user.status !== 'ACTIVE' ||
    !grant?.active ||
    !grant.enrolledAt ||
    !grant.encryptedSecret ||
    session.verifiedAt < grant.enrolledAt
  )
    throw new ForbiddenException('Acesso de plataforma indisponível.');
  return { userId: session.userId, sessionId: session.id };
}

@Injectable()
export class PlatformAuthService {
  get config() {
    return new AuthConfig();
  }
  get cookieName() {
    return this.config.secure ? '__Host-platform_session' : 'platform_session';
  }
  constructor(private readonly database: DatabaseService) {}

  private async credentials(email: string, password: string, ip: string) {
    for (const [value, maximum] of [
      [`platform:ip:${ip}`, 20],
      [`platform:email:${email}`, 5],
    ] as const) {
      const key = createHmac('sha256', this.config.secret)
        .update(value)
        .digest('hex');
      const rows = await this.database.client.$queryRaw<
        Array<{ attempts: number }>
      >`
        INSERT INTO auth_throttles (key, attempts, expires_at) VALUES (${key}, 1, CURRENT_TIMESTAMP + INTERVAL '15 minutes')
        ON CONFLICT (key) DO UPDATE SET
        attempts = CASE WHEN auth_throttles.expires_at <= CURRENT_TIMESTAMP THEN 1 ELSE auth_throttles.attempts + 1 END,
        expires_at = CASE WHEN auth_throttles.expires_at <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes' ELSE auth_throttles.expires_at END RETURNING attempts`;
      if (rows[0]!.attempts > maximum)
        throw new HttpException('Tente novamente mais tarde.', 429);
    }
    const user = await this.database.client.user.findUnique({
      where: { email },
    });
    let valid: boolean;
    try {
      valid = await verifyPassword(password, user?.passwordHash);
    } catch (error) {
      if (error instanceof PasswordBusyError)
        throw new HttpException('Tente novamente mais tarde.', 429);
      throw error;
    }
    if (!valid || !user || user.status !== 'ACTIVE') {
      await recordAudit(this.database.client, {
        data: { type: 'PLATFORM_LOGIN_FAILED', userId: user?.id },
      });
      throw new UnauthorizedException('Credenciais inválidas.');
    }
    return user;
  }

  async enroll(
    email: string,
    password: string,
    invite: string,
    ip: string,
    code?: string,
  ) {
    const user = await this.credentials(email, password, ip);
    return this.database.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT user_id FROM platform_admins WHERE user_id = ${user.id}::uuid FOR UPDATE`;
      const grant = await tx.platformAdmin.findUnique({
        where: { userId: user.id },
      });
      if (
        !grant?.active ||
        grant.enrolledAt ||
        grant.inviteHash !== platformTokenHash(invite) ||
        !grant.inviteExpiresAt ||
        grant.inviteExpiresAt <= new Date()
      )
        throw new UnauthorizedException('Convite inválido.');
      const currentUser = await tx.user.findUnique({
        where: { id: user.id },
        select: { status: true, passwordHash: true },
      });
      if (
        currentUser?.status !== 'ACTIVE' ||
        currentUser.passwordHash !== user.passwordHash
      )
        throw new UnauthorizedException();
      const secret = grant.encryptedSecret
        ? decryptSecret(grant.encryptedSecret, user.id)
        : encodeSecret(randomBytes(20));
      if (!code) {
        if (!grant.encryptedSecret)
          await tx.platformAdmin.update({
            where: { userId: user.id },
            data: { encryptedSecret: encryptSecret(secret, user.id) },
          });
        return {
          secret,
          uri: `otpauth://totp/${encodeURIComponent(`Atendente:${email}`)}?secret=${secret}&issuer=Atendente&algorithm=SHA1&digits=6&period=30`,
        };
      }
      // Confirmation is only valid after the secret was provisioned by the start step.
      const step = grant.encryptedSecret
        ? verifyTotp(secret, code, new Date(), grant.lastStep)
        : null;
      if (step === null) throw new UnauthorizedException('Código inválido.');
      await tx.platformAdmin.update({
        where: { userId: user.id },
        data: {
          enrolledAt: new Date(),
          lastStep: BigInt(step),
          inviteHash: null,
          inviteExpiresAt: null,
        },
      });
      await recordAudit(tx, {
        data: { type: 'PLATFORM_MFA_ENROLLED', userId: user.id },
      });
      return { enrolled: true };
    });
  }

  async login(email: string, password: string, code: string, ip: string) {
    const user = await this.credentials(email, password, ip);
    const token = randomBytes(32).toString('base64url');
    const success = await this.database.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT user_id FROM platform_admins WHERE user_id = ${user.id}::uuid FOR UPDATE`;
      const grant = await tx.platformAdmin.findUnique({
        where: { userId: user.id },
      });
      const currentUser = await tx.user.findUnique({
        where: { id: user.id },
        select: { status: true, passwordHash: true },
      });
      const step =
        grant?.active &&
        grant.enrolledAt &&
        grant.encryptedSecret &&
        currentUser?.status === 'ACTIVE' &&
        currentUser.passwordHash === user.passwordHash
          ? verifyTotp(
              decryptSecret(grant.encryptedSecret, user.id),
              code,
              new Date(),
              grant.lastStep,
            )
          : null;
      if (step === null) {
        await recordAudit(tx, {
          data: { type: 'PLATFORM_LOGIN_FAILED', userId: user.id },
        });
        return false;
      }
      await tx.platformAdmin.update({
        where: { userId: user.id },
        data: { lastStep: BigInt(step) },
      });
      await tx.platformSession.create({
        data: {
          userId: user.id,
          tokenHash: platformTokenHash(token),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      await recordAudit(tx, {
        data: { type: 'PLATFORM_LOGIN_SUCCEEDED', userId: user.id },
      });
      return true;
    });
    if (!success) throw new UnauthorizedException('Credenciais inválidas.');
    return token;
  }

  async authenticate(token: string): Promise<PlatformScope> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new UnauthorizedException();
    return this.database.client.$transaction(async (tx) => {
      const session = await tx.platformSession.findUnique({
        where: { tokenHash: platformTokenHash(token) },
        select: { id: true, userId: true },
      });
      if (!session) throw new UnauthorizedException();
      return requirePlatform(tx, {
        userId: session.userId,
        sessionId: session.id,
      });
    });
  }

  async logout(scope: PlatformScope) {
    await this.database.client.$transaction(async (tx) => {
      await tx.platformSession.deleteMany({
        where: { id: scope.sessionId, userId: scope.userId },
      });
      await recordAudit(tx, {
        data: { type: 'PLATFORM_LOGOUT', userId: scope.userId },
      });
    });
  }
}
