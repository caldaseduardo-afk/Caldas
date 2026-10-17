import { Reflector } from '@nestjs/core';
import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { randomUUID } from 'node:crypto';
import { auditActorContext } from '@atendente/database';
import type { AuthRequest } from '../auth/auth.guard';
/** Context only: domain services remain responsible for explicit transactional audit. */
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (
      this.reflector.getAllAndOverride<boolean>('tenant:optional', [
        context.getHandler(),
        context.getClass(),
      ]) ||
      this.reflector.getAllAndOverride<boolean>('auth:public', [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return next.handle();
    const request = context.switchToHttp().getRequest<AuthRequest>();
    if (!request.activeTenantId || !request.identity) return next.handle();
    const actor = {
      tenantId: request.activeTenantId,
      actorType: 'USER' as const,
      actorUserId: request.identity.id,
      source: request.headers.origin ? ('WEB' as const) : ('API' as const),
      correlationId: randomUUID(),
    };
    return new Observable((subscriber) =>
      auditActorContext.run(actor, () => {
        const subscription = next.handle().subscribe(subscriber);
        return () => subscription.unsubscribe();
      }),
    );
  }
}
