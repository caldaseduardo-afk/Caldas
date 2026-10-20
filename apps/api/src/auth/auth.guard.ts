import {
  PlatformAuthService,
  type PlatformScope,
} from '../platform-admin/platform-auth.service';
import {
  CanActivate,
  Optional,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { parse } from 'cookie';
import { AuthConfig } from './auth.config';
import { AuthService, type Identity } from './auth.service';

export const Public = () => SetMetadata('auth:public', true);
export interface AuthRequest extends Request {
  platform?: PlatformScope;
  platformTenantAccessId?: string;
  platformTenantAccessReason?: string;
  identity?: Identity;
  sessionToken?: string;
  sessionId?: string;
  activeTenantId?: string | null;
}
export function readToken(
  request: Pick<Request, 'headers'>,
  config: AuthConfig,
) {
  const token = parse(request.headers.cookie ?? '')[config.cookieName];
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly config: AuthConfig,
    @Optional() private readonly platformAuth?: PlatformAuthService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const providerWebhook = this.reflector.getAllAndOverride<boolean>(
      'auth:provider-webhook',
      [context.getHandler(), context.getClass()],
    );
    if (
      !providerWebhook &&
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      request.headers.origin !== this.config.origin
    ) {
      throw new ForbiddenException('Origem inválida.');
    }
    if (
      this.reflector.getAllAndOverride<boolean>('auth:public', [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    if (
      this.reflector.getAllAndOverride<boolean>('platform:required', [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      const platformToken =
        this.platformAuth &&
        parse(request.headers.cookie ?? '')[this.platformAuth.cookieName];
      if (!platformToken || !this.platformAuth) {
        const clinicalToken = readToken(request, this.config);
        if (clinicalToken) {
          await this.auth.authenticate(clinicalToken);
          throw new ForbiddenException('Acesso exclusivo da plataforma.');
        }
        throw new UnauthorizedException();
      }
      request.platform = await this.platformAuth.authenticate(platformToken);
      return true;
    }
    const platformTenantToken =
      this.platformAuth &&
      parse(request.headers.cookie ?? '')[
        this.platformAuth.tenantAccessCookieName
      ];
    if (platformTenantToken) {
      if (!this.platformAuth) throw new UnauthorizedException();
      const access =
        await this.platformAuth.authenticateTenantAccess(platformTenantToken);
      request.identity = access.identity;
      request.sessionId = access.sessionId;
      request.activeTenantId = access.tenantId;
      request.platformTenantAccessId = access.accessId;
      request.platformTenantAccessReason = access.reason;
      return true;
    }
    const token = readToken(request, this.config);
    if (!token) throw new UnauthorizedException();
    const authenticated = await this.auth.authenticate(token);
    request.identity = authenticated.identity;
    request.sessionId = authenticated.sessionId;
    request.activeTenantId = authenticated.activeTenantId;
    request.sessionToken = token;
    return true;
  }
}
