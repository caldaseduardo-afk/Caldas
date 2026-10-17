import type { AuthRequest } from '../auth/auth.guard';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Scope,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionName } from '@atendente/database';
import { AuthorizationService } from './authorization.service';

@Injectable({ scope: Scope.REQUEST })
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>('auth:public', targets))
      return true;
    if (this.reflector.getAllAndOverride<boolean>('platform:required', targets)) {
      if (!context.switchToHttp().getRequest<AuthRequest>().platform) throw new ForbiddenException();
      return true;
    }
    // Metadata de método e classe são cumulativos: método não remove exigência da classe.
    const permissions = targets.flatMap(
      (target) =>
        this.reflector.get<PermissionName[]>('permissions:required', target) ??
        [],
    );
    if (permissions.length) {
      await this.authorization.requirePermissions(...permissions);
      return true;
    }
    if (
      this.reflector.getAllAndOverride<boolean>(
        'permissions:identity-only',
        targets,
      )
    )
      return true;
    throw new ForbiddenException('Política de autorização ausente.');
  }
}
