CREATE TYPE "CalendarProviderType" AS ENUM ('GOOGLE_CALENDAR');
CREATE TYPE "CalendarSyncOperation" AS ENUM ('UPSERT', 'CANCEL');
CREATE TYPE "CalendarSyncAttemptStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'RETRYABLE_ERROR', 'PERMANENT_ERROR', 'OBSOLETE');

ALTER TYPE "AuthEventType" ADD VALUE 'CALENDAR_INTEGRATION_CONFIGURED';
ALTER TYPE "AuthEventType" ADD VALUE 'CALENDAR_CONNECTION_TESTED';
ALTER TYPE "AuthEventType" ADD VALUE 'CALENDAR_SYNC_SUCCEEDED';
ALTER TYPE "AuthEventType" ADD VALUE 'CALENDAR_SYNC_FAILED';

ALTER TABLE "appointments"
  ADD COLUMN "calendar_sync_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "calendar_sync_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "calendar_sync_error_code" VARCHAR(64),
  ADD COLUMN "calendar_last_synced_at" TIMESTAMPTZ(3);

CREATE TABLE "calendar_integrations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "provider" "CalendarProviderType" NOT NULL DEFAULT 'GOOGLE_CALENDAR',
  "calendar_id" VARCHAR(512) NOT NULL,
  "credentials_reference" VARCHAR(96) NOT NULL,
  "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
  "last_tested_at" TIMESTAMPTZ(3),
  "last_error_code" VARCHAR(64),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "calendar_integrations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "calendar_integrations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "calendar_integrations_calendar_id_check" CHECK (length(trim("calendar_id")) BETWEEN 1 AND 512),
  CONSTRAINT "calendar_integrations_credentials_reference_check" CHECK ("credentials_reference" ~ '^[A-Z0-9_]{1,96}$')
);

CREATE UNIQUE INDEX "calendar_integrations_tenant_id_key" ON "calendar_integrations"("tenant_id");
CREATE UNIQUE INDEX "calendar_integrations_tenant_id_id_key" ON "calendar_integrations"("tenant_id", "id");
CREATE INDEX "calendar_integrations_status_provider_idx" ON "calendar_integrations"("status", "provider");

CREATE TABLE "calendar_sync_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "appointment_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "operation" "CalendarSyncOperation" NOT NULL,
  "status" "CalendarSyncAttemptStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "correlation_id" UUID NOT NULL,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "error_code" VARCHAR(64),
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "calendar_sync_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "calendar_sync_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "calendar_sync_attempts_appointment_fkey" FOREIGN KEY ("tenant_id", "appointment_id") REFERENCES "appointments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "calendar_sync_attempts_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "calendar_sync_attempts_attempt_count_check" CHECK ("attempt_count" >= 0)
);

CREATE UNIQUE INDEX "calendar_sync_attempts_tenant_id_appointment_id_revision_key" ON "calendar_sync_attempts"("tenant_id", "appointment_id", "revision");
CREATE INDEX "calendar_sync_attempts_status_next_attempt_at_id_idx" ON "calendar_sync_attempts"("status", "next_attempt_at", "id");
CREATE INDEX "calendar_sync_attempts_tenant_id_appointment_id_created_at_idx" ON "calendar_sync_attempts"("tenant_id", "appointment_id", "created_at");
CREATE INDEX "appointments_calendar_reconciliation_idx" ON "appointments"("sync_status", "start_at", "id");

UPDATE "appointments"
SET "calendar_sync_revision" = 1
WHERE "sync_status" <> 'NOT_REQUIRED';

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_calendar_sync_metadata_check" CHECK (
  ("sync_status" = 'NOT_REQUIRED' AND "calendar_provider" IS NULL AND "external_event_id" IS NULL AND "calendar_sync_revision" = 0)
  OR
  ("sync_status" <> 'NOT_REQUIRED' AND "calendar_provider" IS NOT NULL AND "calendar_sync_revision" > 0)
);
