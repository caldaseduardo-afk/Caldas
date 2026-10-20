import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  ForbiddenException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, recordAudit } from '@atendente/database';
import { DatabaseService } from '../auth/database.service';
import { RealtimeEvents } from '../realtime/realtime.events';
import { AuthConfig } from '../auth/auth.config';
import { Optional } from '@nestjs/common';
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
const platformMfaDisabled = () =>
  process.env.NODE_ENV === 'development' &&
  process.env.PLATFORM_MFA_DISABLED === 'true';

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
    (!platformMfaDisabled() &&
      (!grant.enrolledAt ||
        !grant.encryptedSecret ||
        session.verifiedAt < grant.enrolledAt))
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
  get tenantAccessCookieName() {
    return this.config.secure ? '__Host-platform_tenant' : 'platform_tenant';
  }
  constructor(
    private readonly database: DatabaseService,
    @Optional() private readonly events?: RealtimeEvents,
  ) {}

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

  async login(
    email: string,
    password: string,
    code: string | undefined,
    ip: string,
  ) {
    const user = await this.credentials(email, password, ip);
    const token = randomBytes(32).toString('base64url');
    const mfaDisabled = platformMfaDisabled();
    const success = await this.database.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT user_id FROM platform_admins WHERE user_id = ${user.id}::uuid FOR UPDATE`;
      const grant = await tx.platformAdmin.findUnique({
        where: { userId: user.id },
      });
      const currentUser = await tx.user.findUnique({
        where: { id: user.id },
        select: { status: true, passwordHash: true },
      });
      const step = mfaDisabled
        ? null
        : grant?.active &&
            grant.enrolledAt &&
            grant.encryptedSecret &&
            code &&
            currentUser?.status === 'ACTIVE' &&
            currentUser.passwordHash === user.passwordHash
          ? verifyTotp(
              decryptSecret(grant.encryptedSecret, user.id),
              code,
              new Date(),
              grant.lastStep,
            )
          : null;
      if (
        !grant?.active ||
        currentUser?.status !== 'ACTIVE' ||
        currentUser.passwordHash !== user.passwordHash ||
        (!mfaDisabled && step === null)
      ) {
        await recordAudit(tx, {
          data: { type: 'PLATFORM_LOGIN_FAILED', userId: user.id },
        });
        return false;
      }
      if (step !== null)
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
        data: {
          type: 'PLATFORM_LOGIN_SUCCEEDED',
          userId: user.id,
          newValues: { mfaVerified: !mfaDisabled },
        },
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

  async startTenantAccess(
    scope: PlatformScope,
    tenantId: string,
    reason: string,
  ) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const result = await this.database.client.$transaction(async (tx) => {
      await requirePlatform(tx, scope);
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId, status: 'ACTIVE' },
        select: { id: true, name: true, timezone: true },
      });
      if (!tenant) throw new ForbiddenException('Clínica indisponível.');
      const previous = await tx.platformTenantAccess.findMany({
        where: { platformSessionId: scope.sessionId, revokedAt: null },
        select: { id: true, tenantId: true, reason: true },
      });
      await tx.platformTenantAccess.updateMany({
        where: { platformSessionId: scope.sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      for (const old of previous)
        await recordAudit(
          tx,
          {
            data: {
              type: 'PLATFORM_TENANT_ACCESS_ENDED',
              tenantId: old.tenantId,
              resourceId: old.tenantId,
              metadata: {
                accessId: old.id,
                reason: old.reason,
                replaced: true,
              },
            },
          },
          {
            tenantId: old.tenantId,
            actorType: 'PLATFORM_ADMIN',
            actorUserId: scope.userId,
            source: 'PLATFORM',
          },
        );
      const grant = await tx.platformTenantAccess.create({
        data: {
          tokenHash: platformTokenHash(token),
          platformSessionId: scope.sessionId,
          userId: scope.userId,
          tenantId,
          reason,
          expiresAt,
        },
      });
      await recordAudit(
        tx,
        {
          data: {
            type: 'PLATFORM_TENANT_ACCESS_STARTED',
            tenantId,
            resourceId: tenantId,
            metadata: {
              accessId: grant.id,
              reason,
              expiresAt: expiresAt.toISOString(),
            },
          },
        },
        {
          tenantId,
          actorType: 'PLATFORM_ADMIN',
          actorUserId: scope.userId,
          source: 'PLATFORM',
        },
      );
      return { accessId: grant.id, tenant, expiresAt };
    });
    this.events?.invalidateSession(scope.sessionId);
    return { token, ...result };
  }

  async authenticateTenantAccess(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new UnauthorizedException();
    return this.database.client.$transaction(async (tx) => {
      const access = await tx.platformTenantAccess.findUnique({
        where: { tokenHash: platformTokenHash(token) },
        include: {
          user: { select: { id: true, email: true, name: true, status: true } },
          tenant: { select: { id: true, name: true, status: true } },
          platformSession: { select: { id: true, userId: true } },
        },
      });
      if (
        !access ||
        access.revokedAt ||
        access.expiresAt <= new Date() ||
        access.tenant.status !== 'ACTIVE' ||
        access.user.status !== 'ACTIVE'
      )
        throw new UnauthorizedException();
      await requirePlatform(tx, {
        userId: access.userId,
        sessionId: access.platformSessionId,
      });
      if (access.platformSession.userId !== access.userId)
        throw new UnauthorizedException();
      return {
        accessId: access.id,
        sessionId: access.platformSessionId,
        tenantId: access.tenantId,
        tenantName: access.tenant.name,
        reason: access.reason,
        identity: {
          id: access.user.id,
          email: access.user.email,
          name: access.user.name,
        },
      };
    });
  }

  async tenantAccessStatus(scope: PlatformScope) {
    return this.database.client.$transaction(async (tx) => {
      await requirePlatform(tx, scope);
      const access = await tx.platformTenantAccess.findFirst({
        where: {
          platformSessionId: scope.sessionId,
          userId: scope.userId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          tenant: { status: 'ACTIVE' },
        },
        include: { tenant: { select: { id: true, name: true } } },
      });
      return access
        ? { tenant: access.tenant, expiresAt: access.expiresAt }
        : null;
    });
  }

  async endTenantAccess(scope: PlatformScope, token?: string) {
    const result = await this.database.client.$transaction(async (tx) => {
      await requirePlatform(tx, scope);
      const access =
        token && /^[A-Za-z0-9_-]{43}$/.test(token)
          ? await tx.platformTenantAccess.findFirst({
              where: {
                tokenHash: platformTokenHash(token),
                platformSessionId: scope.sessionId,
                userId: scope.userId,
                revokedAt: null,
              },
            })
          : null;
      if (!access) return { ended: false };
      await tx.platformTenantAccess.update({
        where: { id: access.id },
        data: { revokedAt: new Date() },
      });
      await recordAudit(
        tx,
        {
          data: {
            type: 'PLATFORM_TENANT_ACCESS_ENDED',
            tenantId: access.tenantId,
            resourceId: access.tenantId,
            metadata: { accessId: access.id, reason: access.reason },
          },
        },
        {
          tenantId: access.tenantId,
          actorType: 'PLATFORM_ADMIN',
          actorUserId: scope.userId,
          source: 'PLATFORM',
        },
      );
      return { ended: true };
    });
    if (result.ended) this.events?.invalidateSession(scope.sessionId);
    return result;
  }

  async logout(scope: PlatformScope) {
    await this.database.client.$transaction(async (tx) => {
      await requirePlatform(tx, scope);
      const accesses = await tx.platformTenantAccess.findMany({
        where: {
          platformSessionId: scope.sessionId,
          userId: scope.userId,
          revokedAt: null,
        },
        select: { id: true, tenantId: true, reason: true },
      });
      for (const access of accesses) {
        await tx.platformTenantAccess.update({
          where: { id: access.id },
          data: { revokedAt: new Date() },
        });
        await recordAudit(
          tx,
          {
            data: {
              type: 'PLATFORM_TENANT_ACCESS_ENDED',
              tenantId: access.tenantId,
              resourceId: access.tenantId,
              metadata: {
                accessId: access.id,
                reason: access.reason,
                platformLogout: true,
              },
            },
          },
          {
            tenantId: access.tenantId,
            actorType: 'PLATFORM_ADMIN',
            actorUserId: scope.userId,
            source: 'PLATFORM',
          },
        );
      }
      await tx.platformSession.deleteMany({
        where: { id: scope.sessionId, userId: scope.userId },
      });
      await recordAudit(tx, {
        data: { type: 'PLATFORM_LOGOUT', userId: scope.userId },
      });
    });
    this.events?.invalidateSession(scope.sessionId);
  }
}
