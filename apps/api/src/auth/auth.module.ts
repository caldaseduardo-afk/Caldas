import { PlatformSecurityModule } from '../platform-admin/platform-security.module';
import { RealtimeEventsModule } from '../realtime/realtime.events';
import { PermissionsModule } from '../permissions/permissions.module';
import { PermissionGuard } from '../permissions/permission.guard';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthConfig } from './auth.config';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { DatabaseModule } from '../database/database.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { TenantGuard } from '../tenancy/tenant.guard';
import { AuthController } from './auth.controller';

@Module({
  imports: [
    PlatformSecurityModule,
    RealtimeEventsModule,
    DatabaseModule,
    TenancyModule,
    PermissionsModule,
  ],
  exports: [AuthService, AuthConfig],
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: AuthConfig, useFactory: () => new AuthConfig() },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AuthModule {}
