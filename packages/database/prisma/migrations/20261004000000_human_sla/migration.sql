-- CreateEnum
CREATE TYPE "HumanSlaLevel" AS ENUM ('NONE', 'FIRST', 'SECOND', 'EXTERNAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuthEventType" ADD VALUE 'HUMAN_SLA_RULE_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'HUMAN_SLA_RULE_UPDATED';
ALTER TYPE "AuthEventType" ADD VALUE 'HUMAN_SLA_FIRST_ALERT';
ALTER TYPE "AuthEventType" ADD VALUE 'HUMAN_SLA_SECOND_ALERT';
ALTER TYPE "AuthEventType" ADD VALUE 'HUMAN_SLA_EXTERNAL_ALERT_REQUIRED';
ALTER TYPE "AuthEventType" ADD VALUE 'HUMAN_SLA_CLEARED';

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "sla_level" "HumanSlaLevel" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "human_sla_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "first_alert_minutes" INTEGER NOT NULL,
    "second_alert_minutes" INTEGER NOT NULL,
    "external_alert_minutes" INTEGER,
    "internal_alert_enabled" BOOLEAN NOT NULL,
    "external_alert_enabled" BOOLEAN NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "human_sla_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "human_sla_cycles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "claimed_at" TIMESTAMPTZ(3),
    "first_alert_minutes" INTEGER NOT NULL,
    "second_alert_minutes" INTEGER NOT NULL,
    "external_alert_minutes" INTEGER,
    "internal_alert_enabled" BOOLEAN NOT NULL,
    "external_alert_enabled" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "human_sla_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "human_sla_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "level" "HumanSlaLevel" NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "next_dispatch_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "human_sla_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "human_sla_rules_tenant_id_key" ON "human_sla_rules"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "human_sla_rules_tenant_id_id_key" ON "human_sla_rules"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "human_sla_cycles_tenant_id_conversation_id_ended_at_idx" ON "human_sla_cycles"("tenant_id", "conversation_id", "ended_at");

-- CreateIndex
CREATE UNIQUE INDEX "human_sla_cycles_tenant_id_id_key" ON "human_sla_cycles"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "human_sla_jobs_processed_at_next_dispatch_at_id_idx" ON "human_sla_jobs"("processed_at", "next_dispatch_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "human_sla_jobs_tenant_id_cycle_id_level_key" ON "human_sla_jobs"("tenant_id", "cycle_id", "level");

-- AddForeignKey
ALTER TABLE "human_sla_rules" ADD CONSTRAINT "human_sla_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "human_sla_cycles" ADD CONSTRAINT "human_sla_cycles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "human_sla_cycles" ADD CONSTRAINT "human_sla_cycles_tenant_id_conversation_id_fkey" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "conversations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "human_sla_cycles" ADD CONSTRAINT "human_sla_cycles_tenant_id_rule_id_fkey" FOREIGN KEY ("tenant_id", "rule_id") REFERENCES "human_sla_rules"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "human_sla_jobs" ADD CONSTRAINT "human_sla_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "human_sla_jobs" ADD CONSTRAINT "human_sla_jobs_tenant_id_cycle_id_fkey" FOREIGN KEY ("tenant_id", "cycle_id") REFERENCES "human_sla_cycles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Business invariants, including SQL writers.
ALTER TABLE conversations ADD CONSTRAINT conversations_sla_state_check
 CHECK (status = 'NEEDS_HUMAN' OR sla_level = 'NONE');
CREATE UNIQUE INDEX human_sla_cycles_one_open_idx ON human_sla_cycles(tenant_id, conversation_id) WHERE ended_at IS NULL;
ALTER TABLE human_sla_cycles ADD CONSTRAINT human_sla_cycles_dates_check CHECK
 ((ended_at IS NULL OR ended_at >= requested_at) AND
  (claimed_at IS NULL OR (ended_at IS NOT NULL AND claimed_at >= requested_at AND claimed_at <= ended_at)));
ALTER TABLE human_sla_jobs ADD CONSTRAINT human_sla_jobs_level_check CHECK (level <> 'NONE');
ALTER TABLE human_sla_rules ADD CONSTRAINT human_sla_rules_thresholds_check CHECK (
 first_alert_minutes BETWEEN 1 AND 525600 AND second_alert_minutes BETWEEN 1 AND 525600
 AND first_alert_minutes < second_alert_minutes
 AND (external_alert_minutes IS NULL OR external_alert_minutes BETWEEN 1 AND 525600)
 AND (NOT external_alert_enabled OR (external_alert_minutes IS NOT NULL AND external_alert_minutes > second_alert_minutes)));
ALTER TABLE human_sla_cycles ADD CONSTRAINT human_sla_cycles_thresholds_check CHECK (
 first_alert_minutes BETWEEN 1 AND 525600 AND second_alert_minutes BETWEEN 1 AND 525600
 AND first_alert_minutes < second_alert_minutes
 AND (external_alert_minutes IS NULL OR external_alert_minutes BETWEEN 1 AND 525600)
 AND (NOT external_alert_enabled OR (external_alert_minutes IS NOT NULL AND external_alert_minutes > second_alert_minutes)));
