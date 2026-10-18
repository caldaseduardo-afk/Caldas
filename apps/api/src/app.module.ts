import { PlatformModule } from './platform-admin/platform.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuditModule } from './audit/audit.module';
import { AIConfigurationModule } from './ai-configuration/ai-configuration.module';
import { ToolsModule } from './tools/tools.module';
import { AIModule } from './ai/ai.module';
import { MessagingModule } from './messaging/messaging.module';
import { HumanSlaModule } from './human-sla/human-sla.module';
import { RealtimeModule } from './realtime/realtime.module';
import { InboxModule } from './inbox/inbox.module';
import { HoldsModule } from './holds/holds.module';
import { AvailabilityModule } from './availability/availability.module';
import { ProvidersModule } from './providers/providers.module';
import { CatalogModule } from './catalog/catalog.module';
import { PatientsModule } from './patients/patients.module';
import { ContactsModule } from './contacts/contacts.module';
import { ClinicsModule } from './clinics/clinics.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ConversationsModule } from './conversations/conversations.module';
import { ConversationEngineModule } from './conversation-engine/conversation-engine.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CalendarIntegrationsModule } from './calendar-integrations/calendar-integrations.module';
import { AuthModule } from './auth/auth.module';
import { PlansModule } from './plans/plans.module';
import { HealthController } from './health.controller';
import { DatabaseModule } from './database/database.module';
import { RateLimitInterceptor } from './rate-limit/rate-limit.interceptor';
import { RateLimitService } from './rate-limit/rate-limit.service';
@Module({
  imports: [
    PlatformModule,
    PlansModule,
    AnalyticsModule,
    AuthModule,
    AuditModule,
    AIModule,
    AIConfigurationModule,
    ToolsModule,
    MessagingModule,
    HumanSlaModule,
    ClinicsModule,
    ContactsModule,
    PatientsModule,
    CatalogModule,
    ProvidersModule,
    AvailabilityModule,
    HoldsModule,
    AppointmentsModule,
    NotificationsModule,
    ConversationsModule,
    ConversationEngineModule,
    KnowledgeModule,
    InboxModule,
    RealtimeModule,
    CalendarIntegrationsModule,
    DatabaseModule,
  ],
  controllers: [HealthController],
  providers: [
    RateLimitService,
    { provide: APP_INTERCEPTOR, useClass: RateLimitInterceptor },
  ],
})
export class AppModule {}
