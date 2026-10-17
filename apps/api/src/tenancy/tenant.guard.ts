import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  Scope,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantContext } from './tenant.context';

export const TenantOptional = () => SetMetadata('tenant:optional', true);

@Injectable({ scope: Scope.REQUEST })
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly context: TenantContext,
  ) {}
  async canActivate(execution: ExecutionContext) {
    const targets = [execution.getHandler(), execution.getClass()];
    if (
      this.reflector.getAllAndOverride<boolean>('platform:required', targets) ||
      this.reflector.getAllAndOverride<boolean>('auth:public', targets) ||
      this.reflector.getAllAndOverride<boolean>('tenant:optional', targets)
    )
      return true;
    await this.context.requireTenant();
    return true;
  }
}
