import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TenantContext } from './tenant.context';

@Module({
  imports: [DatabaseModule],
  providers: [TenantContext],
  exports: [TenantContext],
})
export class TenantContextModule {}
