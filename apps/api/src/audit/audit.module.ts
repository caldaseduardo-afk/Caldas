import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditContextInterceptor } from './audit-context.interceptor';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { AuditController } from './audit.controller';
import { AuditQueryService } from './audit-query.service';
@Module({
  imports: [DatabaseModule, PermissionsModule],
  controllers: [AuditController],
  providers: [
    AuditQueryService,
    { provide: APP_INTERCEPTOR, useClass: AuditContextInterceptor },
  ],
})
export class AuditModule {}
