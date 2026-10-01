import {
  CanActivate,
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
  identity?: Identity;
  sessionToken?: string;
  sessionId?: string;
  activeTenantId?: string | null;
}
export function readToken(request: Request, config: AuthConfig) {
  const token = parse(request.headers.cookie ?? '')[config.cookieName];
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly config: AuthConfig,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    if (
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
