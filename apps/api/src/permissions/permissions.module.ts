import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TenantContextModule } from '../tenancy/tenant-context.module';
import { AuthorizationService } from './authorization.service';

@Module({
  imports: [DatabaseModule, TenantContextModule],
  providers: [AuthorizationService],
  exports: [AuthorizationService],
})
export class PermissionsModule {}
