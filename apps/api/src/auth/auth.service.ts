import { recordAudit } from '@atendente/database';
import { RealtimeEvents } from '../realtime/realtime.events';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  HttpException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthConfig } from './auth.config';
import { DatabaseService } from './database.service';
import { PasswordBusyError, verifyPassword } from './password';

export function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
export interface Identity {
  id: string;
  email: string;
  name: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: AuthConfig,
    @Optional() private readonly events?: RealtimeEvents,
  ) {}

  private pseudonym(value: string) {
    return createHmac('sha256', this.config.secret).update(value).digest('hex');
  }

  async throttle(ip: string, email: string) {
    const client = this.database.client;
    for (const [value, maximum] of [
      [`ip:${ip}`, 20],
      [`email:${email}`, 5],
    ] as const) {
      const key = this.pseudonym(value);
      const rows = await client.$queryRaw<Array<{ attempts: number }>>`
        INSERT INTO auth_throttles (key, attempts, expires_at)
        VALUES (${key}, 1, CURRENT_TIMESTAMP + INTERVAL '15 minutes')
        ON CONFLICT (key) DO UPDATE SET
          attempts = CASE WHEN auth_throttles.expires_at <= CURRENT_TIMESTAMP THEN 1 ELSE auth_throttles.attempts + 1 END,
          expires_at = CASE WHEN auth_throttles.expires_at <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes' ELSE auth_throttles.expires_at END
        RETURNING attempts`;
      if (rows[0]!.attempts > maximum) {
        await recordAudit(client, {
          data: { type: 'LOGIN_THROTTLED', ipHash: this.pseudonym(`ip:${ip}`) },
        });
        throw new HttpException('Tente novamente mais tarde.', 429);
      }
    }
  }

  async login(email: string, password: string, ip: string, oldToken?: string) {
    await this.throttle(ip, email);
    const client = this.database.client;
    const user = await client.user.findUnique({ where: { email } });
    let valid: boolean;
    try {
      valid = await verifyPassword(password, user?.passwordHash);
    } catch (error) {
      if (error instanceof PasswordBusyError)
        throw new HttpException('Tente novamente mais tarde.', 429);
      throw error;
    }
    const ipHash = this.pseudonym(`ip:${ip}`);
    if (
      !valid ||
      !user ||
      user.status !== 'ACTIVE' ||
      user.mfaEnabled ||
      user.mfaRequired
    ) {
      await recordAudit(client, {
        data: { type: 'LOGIN_FAILED', userId: user?.id, ipHash },
      });
      throw new UnauthorizedException('Credenciais inválidas.');
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.sessionMs);
    const oldSessionId = await client.$transaction(async (tx) => {
      const old = oldToken
        ? await tx.authSession.findUnique({
            where: { tokenHash: tokenHash(oldToken) },
            select: { id: true },
          })
        : null;
      if (oldToken)
        await tx.authSession.deleteMany({
          where: { tokenHash: tokenHash(oldToken) },
        });
      await tx.authSession.create({
        data: { userId: user.id, tokenHash: tokenHash(token), expiresAt },
      });
      await recordAudit(tx, {
        data: { type: 'LOGIN_SUCCEEDED', userId: user.id, ipHash },
      });
      return old?.id;
    });
    if (oldSessionId) this.events?.invalidateSession(oldSessionId);
    return { token, user: { id: user.id, name: user.name, email: user.email } };
  }

  async authenticate(token: string): Promise<{
    identity: Identity;
    sessionId: string;
    activeTenantId: string | null;
  }> {
    const session = await this.database.client.authSession.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: { user: true },
    });
    if (
      !session ||
      session.expiresAt.getTime() <= Date.now() ||
      session.user.status !== 'ACTIVE' ||
      session.user.mfaEnabled ||
      session.user.mfaRequired
    ) {
      throw new UnauthorizedException();
    }
    return {
      identity: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      },
      sessionId: session.id,
      activeTenantId: session.activeTenantId,
    };
  }

  async logout(token: string, userId: string) {
    const sessionId = await this.database.client.$transaction(async (tx) => {
      const session = await tx.authSession.findFirst({
        where: { tokenHash: tokenHash(token), userId },
        select: { id: true },
      });
      await tx.authSession.deleteMany({
        where: { tokenHash: tokenHash(token), userId },
      });
      await recordAudit(tx, { data: { type: 'LOGOUT', userId } });
      return session?.id;
    });
    if (sessionId) this.events?.invalidateSession(sessionId);
  }
}
