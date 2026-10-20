import { Reflector } from '@nestjs/core';
import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
} from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { randomUUID } from 'node:crypto';
import { auditActorContext, recordAudit } from '@atendente/database';
import type { AuthRequest } from '../auth/auth.guard';
import { DatabaseService } from '../auth/database.service';
/** Context only: domain services remain responsible for explicit transactional audit. */
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly database: DatabaseService,
  ) {}
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
      actorType: request.platformTenantAccessId
        ? ('PLATFORM_ADMIN' as const)
        : ('USER' as const),
      actorUserId: request.identity.id,
      source: request.platformTenantAccessId
        ? ('PLATFORM' as const)
        : request.headers.origin
          ? ('WEB' as const)
          : ('API' as const),
      ...(request.platformTenantAccessId
        ? { actorReferenceId: request.platformTenantAccessId }
        : {}),
      correlationId: randomUUID(),
    };
    return new Observable((subscriber) =>
      auditActorContext.run(actor, () => {
        const stream = next.handle().pipe(
          mergeMap((result) =>
            from(
              (async () => {
                if (
                  request.platformTenantAccessId &&
                  request.identity &&
                  request.activeTenantId
                ) {
                  const write = !['GET', 'HEAD', 'OPTIONS'].includes(
                    request.method,
                  );
                  await recordAudit(
                    this.database.client,
                    {
                      data: {
                        type: write
                          ? 'PLATFORM_TENANT_ACCESS_WRITE'
                          : 'PLATFORM_TENANT_ACCESS_READ',
                        userId: request.identity.id,
                        tenantId: request.activeTenantId,
                        resourceId: request.activeTenantId,
                        metadata: {
                          accessId: request.platformTenantAccessId,
                          reason: request.platformTenantAccessReason,
                          method: request.method,
                          route:
                            `${request.baseUrl ?? ''}${request.route?.path ?? 'unmatched'}`.slice(
                              0,
                              300,
                            ),
                        },
                      },
                    },
                    actor,
                  );
                }
                return result;
              })(),
            ),
          ),
        );
        const subscription = stream.subscribe(subscriber);
        return () => subscription.unsubscribe();
      }),
    );
  }
}
