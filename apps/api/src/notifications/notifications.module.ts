import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { NotificationRepository } from './notification.repository';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
@Module({
  imports: [DatabaseModule, PermissionsModule],
  providers: [NotificationRepository, NotificationsService],
  controllers: [NotificationsController],
})
export class NotificationsModule {}
