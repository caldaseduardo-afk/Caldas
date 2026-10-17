-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "AppointmentSource" AS ENUM ('WHATSAPP_AI', 'WHATSAPP_HUMAN', 'WEB', 'PHONE', 'MANUAL', 'IMPORT');

-- CreateEnum
CREATE TYPE "AppointmentActorType" AS ENUM ('AI', 'USER', 'SYSTEM', 'IMPORT');

-- CreateEnum
CREATE TYPE "CalendarSyncStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'SYNCED', 'ERROR');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuthEventType" ADD VALUE 'APPOINTMENT_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'APPOINTMENT_CONFIRMED';
ALTER TYPE "AuthEventType" ADD VALUE 'APPOINTMENT_CANCELLED';
ALTER TYPE "AuthEventType" ADD VALUE 'APPOINTMENT_RESCHEDULED';
ALTER TYPE "AuthEventType" ADD VALUE 'APPOINTMENT_CHECKED_IN';
ALTER TYPE "AuthEventType" ADD VALUE 'APPOINTMENT_COMPLETED';
ALTER TYPE "AuthEventType" ADD VALUE 'APPOINTMENT_NO_SHOW';

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "contact_id" UUID,
    "service_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "hold_id" UUID,
    "previous_appointment_id" UUID,
    "created_by_type" "AppointmentActorType" NOT NULL,
    "created_by_id" UUID,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "occupied_start_at" TIMESTAMPTZ(3) NOT NULL,
    "occupied_end_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "source" "AppointmentSource" NOT NULL DEFAULT 'MANUAL',
    "calendar_provider" VARCHAR(100),
    "external_event_id" VARCHAR(500),
    "sync_status" "CalendarSyncStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "notes" VARCHAR(2000),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancellation_reason" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointments_tenant_id_provider_id_unit_id_status_occupied__idx" ON "appointments"("tenant_id", "provider_id", "unit_id", "status", "occupied_start_at", "occupied_end_at");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_patient_id_start_at_idx" ON "appointments"("tenant_id", "patient_id", "start_at");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_contact_id_idx" ON "appointments"("tenant_id", "contact_id");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_service_id_idx" ON "appointments"("tenant_id", "service_id");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_sync_status_idx" ON "appointments"("tenant_id", "sync_status");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_created_at_idx" ON "appointments"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_tenant_id_id_key" ON "appointments"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_tenant_id_patient_id_id_key" ON "appointments"("tenant_id", "patient_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_tenant_id_patient_id_previous_appointment_id_key" ON "appointments"("tenant_id", "patient_id", "previous_appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_tenant_id_previous_appointment_id_key" ON "appointments"("tenant_id", "previous_appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_tenant_id_hold_id_key" ON "appointments"("tenant_id", "hold_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_tenant_id_calendar_provider_external_event_id_key" ON "appointments"("tenant_id", "calendar_provider", "external_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_holds_tenant_id_id_key" ON "appointment_holds"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_contact_id_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contacts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_service_id_fkey" FOREIGN KEY ("tenant_id", "service_id") REFERENCES "services"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_provider_id_fkey" FOREIGN KEY ("tenant_id", "provider_id") REFERENCES "providers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_provider_id_service_id_fkey" FOREIGN KEY ("tenant_id", "provider_id", "service_id") REFERENCES "provider_services"("tenant_id", "provider_id", "service_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_provider_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "provider_id", "unit_id") REFERENCES "provider_units"("tenant_id", "provider_id", "unit_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_id_tenant_id_fkey" FOREIGN KEY ("created_by_id", "tenant_id") REFERENCES "user_tenants"("user_id", "tenant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_hold_id_fkey" FOREIGN KEY ("tenant_id", "hold_id") REFERENCES "appointment_holds"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_patient_id_previous_appointment_id_fkey" FOREIGN KEY ("tenant_id", "patient_id", "previous_appointment_id") REFERENCES "appointments"("tenant_id", "patient_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Occupancy is a snapshot; terminal appointments remain history.
ALTER TABLE appointments ADD CONSTRAINT appointments_interval_check CHECK (
 start_at < end_at AND occupied_start_at <= start_at AND end_at <= occupied_end_at
 AND isfinite(start_at) AND isfinite(end_at) AND isfinite(occupied_start_at) AND isfinite(occupied_end_at));
ALTER TABLE appointments ADD CONSTRAINT appointments_actor_check CHECK (
 (created_by_type = 'USER' AND created_by_id IS NOT NULL) OR
 (created_by_type <> 'USER' AND created_by_id IS NULL));
ALTER TABLE appointments ADD CONSTRAINT appointments_cancellation_check CHECK (
 (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND isfinite(cancelled_at)) OR
 (status <> 'CANCELLED' AND cancelled_at IS NULL AND cancellation_reason IS NULL));
ALTER TABLE appointments ADD CONSTRAINT appointments_previous_check CHECK (previous_appointment_id IS DISTINCT FROM id);
ALTER TABLE appointments ADD CONSTRAINT appointments_calendar_check CHECK (
 (calendar_provider IS NULL AND external_event_id IS NULL AND sync_status = 'NOT_REQUIRED') OR
 (calendar_provider IS NOT NULL AND sync_status <> 'NOT_REQUIRED'));
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap EXCLUDE USING gist (
 tenant_id WITH =, provider_id WITH =, unit_id WITH =,
 tstzrange(occupied_start_at, occupied_end_at, '[)') WITH &&
) WHERE (status IN ('PENDING_CONFIRMATION','CONFIRMED','CHECKED_IN'));

-- Updating the common resource serializes writes across both tables, including
-- SQL writers. Under snapshot isolation a stale writer aborts rather than bypassing
-- the check. Under READ COMMITTED the volatile trigger query sees committed rows
-- after waiting for the resource. Same-table conflicts also have EXCLUDE protection.
CREATE FUNCTION prevent_cross_scheduling_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME = 'appointments' THEN
  IF NEW.status NOT IN ('PENDING_CONFIRMATION','CONFIRMED','CHECKED_IN') THEN RETURN NEW; END IF;
 ELSE
  IF NEW.status <> 'ACTIVE' OR NEW.expires_at <= clock_timestamp() THEN RETURN NEW; END IF;
 END IF;
 UPDATE provider_units SET updated_at = clock_timestamp()
 WHERE tenant_id=NEW.tenant_id AND provider_id=NEW.provider_id AND unit_id=NEW.unit_id;
 IF TG_TABLE_NAME = 'appointments' THEN
  IF EXISTS (SELECT 1 FROM appointment_holds h WHERE h.tenant_id=NEW.tenant_id
   AND h.provider_id=NEW.provider_id AND h.unit_id=NEW.unit_id
   AND h.status='ACTIVE' AND h.expires_at>clock_timestamp()
   AND h.occupied_start_at<NEW.occupied_end_at AND h.occupied_end_at>NEW.occupied_start_at)
  THEN RAISE EXCEPTION 'Scheduling conflict' USING ERRCODE='23P01'; END IF;
 ELSE
  IF EXISTS (SELECT 1 FROM appointments a WHERE a.tenant_id=NEW.tenant_id
   AND a.provider_id=NEW.provider_id AND a.unit_id=NEW.unit_id
   AND a.status IN ('PENDING_CONFIRMATION','CONFIRMED','CHECKED_IN')
   AND a.occupied_start_at<NEW.occupied_end_at AND a.occupied_end_at>NEW.occupied_start_at)
  THEN RAISE EXCEPTION 'Scheduling conflict' USING ERRCODE='23P01'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER appointments_cross_overlap BEFORE INSERT OR UPDATE OF status, occupied_start_at, occupied_end_at, tenant_id, provider_id, unit_id ON appointments FOR EACH ROW EXECUTE FUNCTION prevent_cross_scheduling_overlap();
CREATE TRIGGER holds_cross_overlap BEFORE INSERT OR UPDATE OF status, occupied_start_at, occupied_end_at, tenant_id, provider_id, unit_id, expires_at ON appointment_holds FOR EACH ROW EXECUTE FUNCTION prevent_cross_scheduling_overlap();
