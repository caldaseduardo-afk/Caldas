-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('CONFIRMATION', 'REMINDER');

-- CreateEnum
CREATE TYPE "OutsideWindowPolicy" AS ENUM ('PREVIOUS_ALLOWED_TIME', 'NEXT_ALLOWED_TIME', 'SKIP');

-- CreateEnum
CREATE TYPE "NoResponseAction" AS ENUM ('NONE', 'MARK_UNCONFIRMED', 'NEEDS_HUMAN', 'CANCEL_APPOINTMENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuthEventType" ADD VALUE 'NOTIFICATION_RULE_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'NOTIFICATION_RULE_UPDATED';

-- CreateTable
CREATE TABLE "notification_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "offset_minutes" INTEGER NOT NULL,
    "allowed_start_time" TIME(0) NOT NULL,
    "allowed_end_time" TIME(0) NOT NULL,
    "allowed_weekdays" "Weekday"[],
    "outside_window_policy" "OutsideWindowPolicy" NOT NULL,
    "retry_enabled" BOOLEAN NOT NULL DEFAULT false,
    "retry_after_minutes" INTEGER,
    "max_attempts" INTEGER NOT NULL DEFAULT 1,
    "minimum_time_before_appointment" INTEGER NOT NULL DEFAULT 0,
    "action_if_no_response" "NoResponseAction" NOT NULL DEFAULT 'NONE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_rules_tenant_id_type_active_idx" ON "notification_rules"("tenant_id", "type", "active");

-- CreateIndex
CREATE INDEX "notification_rules_tenant_id_created_at_idx" ON "notification_rules"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_rules_tenant_id_id_key" ON "notification_rules"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Prisma scalar lists may be nullable in generated SQL; domain requires days.
ALTER TABLE notification_rules ALTER COLUMN allowed_weekdays SET NOT NULL;
ALTER TABLE notification_rules ADD CONSTRAINT notification_rules_days_check CHECK (
 cardinality(allowed_weekdays) BETWEEN 1 AND 7
 AND array_ndims(allowed_weekdays)=1
 AND array_position(allowed_weekdays,NULL) IS NULL);
ALTER TABLE notification_rules ADD CONSTRAINT notification_rules_window_check CHECK (
 allowed_start_time < allowed_end_time AND allowed_end_time < TIME '24:00:00'
 AND EXTRACT(SECOND FROM allowed_start_time)=0 AND EXTRACT(SECOND FROM allowed_end_time)=0);
ALTER TABLE notification_rules ADD CONSTRAINT notification_rules_numbers_check CHECK (
 offset_minutes >= 0 AND minimum_time_before_appointment >= 0 AND max_attempts >= 1
 AND (retry_after_minutes IS NULL OR retry_after_minutes>0)
 AND (NOT retry_enabled OR retry_after_minutes IS NOT NULL));
