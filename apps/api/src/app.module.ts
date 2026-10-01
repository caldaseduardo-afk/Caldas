import { CatalogModule } from './catalog/catalog.module';
import { PatientsModule } from './patients/patients.module';
import { ContactsModule } from './contacts/contacts.module';
import { ClinicsModule } from './clinics/clinics.module';
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health.controller';
@Module({
  imports: [
    AuthModule,
    ClinicsModule,
    ContactsModule,
    PatientsModule,
    CatalogModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
