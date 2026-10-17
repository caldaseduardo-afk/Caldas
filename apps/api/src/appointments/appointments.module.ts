import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { AppointmentRepository } from './appointment.repository';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
@Module({
  imports: [DatabaseModule, PermissionsModule],
  providers: [AppointmentRepository, AppointmentsService],
  exports: [AppointmentsService],
  controllers: [AppointmentsController],
})
export class AppointmentsModule {}
