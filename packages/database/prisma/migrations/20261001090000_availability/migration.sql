-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "ScheduleExceptionType" AS ENUM ('BLOCK', 'EXTRA_AVAILABILITY', 'VACATION', 'HOLIDAY', 'MEETING', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuthEventType" ADD VALUE 'AVAILABILITY_RULE_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'AVAILABILITY_RULE_UPDATED';
ALTER TYPE "AuthEventType" ADD VALUE 'SCHEDULE_EXCEPTION_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'SCHEDULE_EXCEPTION_UPDATED';

-- CreateTable
CREATE TABLE "availability_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "weekday" "Weekday" NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "availability_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_exceptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "start_time" TIME(0),
    "end_time" TIME(0),
    "type" "ScheduleExceptionType" NOT NULL,
    "reason" VARCHAR(2000),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "availability_rules_tenant_id_provider_id_unit_id_weekday_ac_idx" ON "availability_rules"("tenant_id", "provider_id", "unit_id", "weekday", "active");

-- CreateIndex
CREATE INDEX "availability_rules_tenant_id_valid_from_valid_until_idx" ON "availability_rules"("tenant_id", "valid_from", "valid_until");

-- CreateIndex
CREATE INDEX "availability_rules_tenant_id_unit_id_active_idx" ON "availability_rules"("tenant_id", "unit_id", "active");

-- CreateIndex
CREATE INDEX "schedule_exceptions_tenant_id_provider_id_unit_id_date_acti_idx" ON "schedule_exceptions"("tenant_id", "provider_id", "unit_id", "date", "active");

-- CreateIndex
CREATE INDEX "schedule_exceptions_tenant_id_date_type_active_idx" ON "schedule_exceptions"("tenant_id", "date", "type", "active");

-- CreateIndex
CREATE INDEX "schedule_exceptions_tenant_id_unit_id_date_idx" ON "schedule_exceptions"("tenant_id", "unit_id", "date");

-- AddForeignKey
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_tenant_id_provider_id_fkey" FOREIGN KEY ("tenant_id", "provider_id") REFERENCES "providers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_tenant_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_tenant_id_provider_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "provider_id", "unit_id") REFERENCES "provider_units"("tenant_id", "provider_id", "unit_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_tenant_id_provider_id_fkey" FOREIGN KEY ("tenant_id", "provider_id") REFERENCES "providers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_tenant_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_tenant_id_provider_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "provider_id", "unit_id") REFERENCES "provider_units"("tenant_id", "provider_id", "unit_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Calendário civil e precisão de minuto, não instantes UTC.
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_times_check" CHECK (
  "start_time" < "end_time" AND "end_time" < TIME '24:00'
  AND EXTRACT(SECOND FROM "start_time") = 0 AND EXTRACT(SECOND FROM "end_time") = 0
);
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_dates_check" CHECK (
  isfinite("valid_from") AND ("valid_until" IS NULL OR (isfinite("valid_until") AND "valid_until" >= "valid_from"))
);
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_times_check" CHECK (
  ("start_time" IS NULL AND "end_time" IS NULL AND "type" <> 'EXTRA_AVAILABILITY')
  OR ("start_time" IS NOT NULL AND "end_time" IS NOT NULL AND "start_time" < "end_time"
    AND "end_time" < TIME '24:00' AND EXTRACT(SECOND FROM "start_time") = 0 AND EXTRACT(SECOND FROM "end_time") = 0)
);
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_date_check" CHECK (isfinite("date"));

-- Garantia física, inclusive contra gravações concorrentes fora da API.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_no_overlap"
EXCLUDE USING gist (
  "tenant_id" WITH =,
  "provider_id" WITH =,
  "unit_id" WITH =,
  "weekday" WITH =,
  int4range(EXTRACT(EPOCH FROM "start_time")::integer, EXTRACT(EPOCH FROM "end_time")::integer, '[)') WITH &&,
  daterange("valid_from", "valid_until", '[]') WITH &&
) WHERE ("active");
