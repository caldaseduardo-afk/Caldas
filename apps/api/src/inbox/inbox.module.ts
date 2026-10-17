import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { InboxRepository } from './inbox.repository';
import { InboxService } from './inbox.service';
import { InboxController } from './inbox.controller';
@Module({
  imports: [DatabaseModule, PermissionsModule],
  controllers: [InboxController],
  providers: [InboxRepository, InboxService],
})
export class InboxModule {}
