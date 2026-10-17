-- CreateEnum
CREATE TYPE "AppointmentHoldStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'RELEASED', 'CONSUMED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuthEventType" ADD VALUE 'HOLD_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'HOLD_RELEASED';
ALTER TYPE "AuthEventType" ADD VALUE 'HOLD_EXPIRED';

-- CreateTable
CREATE TABLE "appointment_holds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "contact_id" UUID,
    "service_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "creator_id" UUID NOT NULL,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "occupied_start_at" TIMESTAMPTZ(3) NOT NULL,
    "occupied_end_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "AppointmentHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_holds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointment_holds_tenant_id_provider_id_unit_id_status_occu_idx" ON "appointment_holds"("tenant_id", "provider_id", "unit_id", "status", "occupied_start_at", "occupied_end_at");

-- CreateIndex
CREATE INDEX "appointment_holds_status_expires_at_tenant_id_idx" ON "appointment_holds"("status", "expires_at", "tenant_id");

-- CreateIndex
CREATE INDEX "appointment_holds_tenant_id_patient_id_idx" ON "appointment_holds"("tenant_id", "patient_id");

-- CreateIndex
CREATE INDEX "appointment_holds_tenant_id_service_id_idx" ON "appointment_holds"("tenant_id", "service_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_holds_tenant_id_request_id_key" ON "appointment_holds"("tenant_id", "request_id");

-- AddForeignKey
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_tenant_id_contact_id_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contacts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_tenant_id_service_id_fkey" FOREIGN KEY ("tenant_id", "service_id") REFERENCES "services"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_tenant_id_provider_id_fkey" FOREIGN KEY ("tenant_id", "provider_id") REFERENCES "providers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_tenant_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_tenant_id_provider_id_service_id_fkey" FOREIGN KEY ("tenant_id", "provider_id", "service_id") REFERENCES "provider_services"("tenant_id", "provider_id", "service_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_tenant_id_provider_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "provider_id", "unit_id") REFERENCES "provider_units"("tenant_id", "provider_id", "unit_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_creator_id_tenant_id_fkey" FOREIGN KEY ("creator_id", "tenant_id") REFERENCES "user_tenants"("user_id", "tenant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_times_check" CHECK (
  "start_at" < "end_at" AND "occupied_start_at" <= "start_at" AND "end_at" <= "occupied_end_at"
  AND isfinite("start_at") AND isfinite("end_at") AND isfinite("occupied_start_at") AND isfinite("occupied_end_at")
  AND "expires_at" > "created_at" AND isfinite("expires_at")
);
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_no_overlap"
EXCLUDE USING gist (
  "tenant_id" WITH =, "provider_id" WITH =, "unit_id" WITH =,
  tstzrange("occupied_start_at", "occupied_end_at", '[)') WITH &&
) WHERE ("status" = 'ACTIVE');

CREATE FUNCTION prevent_hold_terminal_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'ACTIVE' AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'HOLD terminal' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER appointment_holds_terminal_state BEFORE UPDATE OF status ON appointment_holds
FOR EACH ROW EXECUTE FUNCTION prevent_hold_terminal_transition();
