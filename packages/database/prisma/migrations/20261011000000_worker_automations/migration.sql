-- CreateEnum
CREATE TYPE "NotificationAttemptStatus" AS ENUM ('SCHEDULED', 'PROCESSING', 'SENT', 'SKIPPED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "notification_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "notification_rule_id" UUID NOT NULL,
    "message_id" UUID,
    "type" "NotificationType" NOT NULL,
    "cycle_key" CHAR(64) NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "next_dispatch_at" TIMESTAMPTZ(3) NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "no_response_at" TIMESTAMPTZ(3),
    "status" "NotificationAttemptStatus" NOT NULL DEFAULT 'SCHEDULED',
    "provider_message_id" VARCHAR(300),
    "error_code" VARCHAR(64),
    "outcome" VARCHAR(64),
    "correlation_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_attempts_attempt_number_check" CHECK (attempt_number >= 1),
    CONSTRAINT "notification_attempts_cycle_key_check" CHECK (cycle_key ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "notification_attempts_tenant_id_id_key" ON "notification_attempts"("tenant_id", "id");
CREATE UNIQUE INDEX "notification_attempts_cycle_key" ON "notification_attempts"("tenant_id", "appointment_id", "notification_rule_id", "cycle_key", "attempt_number");
CREATE UNIQUE INDEX "notification_attempts_tenant_id_message_id_key" ON "notification_attempts"("tenant_id", "message_id");
CREATE INDEX "notification_attempts_status_next_dispatch_at_id_idx" ON "notification_attempts"("status", "next_dispatch_at", "id");
CREATE INDEX "notification_attempts_tenant_id_appointment_id_status_idx" ON "notification_attempts"("tenant_id", "appointment_id", "status");
CREATE INDEX "notification_attempts_tenant_id_notification_rule_id_status_idx" ON "notification_attempts"("tenant_id", "notification_rule_id", "status");
CREATE INDEX "notification_attempts_tenant_id_scheduled_at_idx" ON "notification_attempts"("tenant_id", "scheduled_at");
CREATE INDEX "notification_attempts_tenant_id_created_at_idx" ON "notification_attempts"("tenant_id", "created_at");
CREATE INDEX "appointments_tenant_id_status_start_at_idx" ON "appointments"("tenant_id", "status", "start_at");

ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_tenant_id_appointment_id_fkey" FOREIGN KEY ("tenant_id", "appointment_id") REFERENCES "appointments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_tenant_id_notification_rule_id_fkey" FOREIGN KEY ("tenant_id", "notification_rule_id") REFERENCES "notification_rules"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_tenant_id_message_id_fkey" FOREIGN KEY ("tenant_id", "message_id") REFERENCES "messages"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
