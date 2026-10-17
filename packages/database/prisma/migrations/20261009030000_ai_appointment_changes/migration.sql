CREATE TYPE "SchedulingWorkflowType" AS ENUM ('SCHEDULING', 'CANCELLATION', 'RESCHEDULING');

ALTER TYPE "SchedulingWorkflowStep" ADD VALUE 'IDENTIFY_APPOINTMENT';
ALTER TYPE "SchedulingWorkflowStep" ADD VALUE 'COLLECT_NEW_PREFERENCES';
ALTER TYPE "SchedulingWorkflowStep" ADD VALUE 'SEARCH_NEW_SLOTS';
ALTER TYPE "SchedulingWorkflowStep" ADD VALUE 'SELECT_NEW_SLOT';
ALTER TYPE "SchedulingWorkflowStep" ADD VALUE 'WAITING_CANCELLATION_CONFIRMATION';
ALTER TYPE "SchedulingWorkflowStep" ADD VALUE 'WAITING_RESCHEDULE_CONFIRMATION';

ALTER TABLE "scheduling_workflows"
  ADD COLUMN "workflow_type" "SchedulingWorkflowType" NOT NULL DEFAULT 'SCHEDULING',
  ADD COLUMN "target_appointment_id" UUID;

ALTER TABLE "scheduling_workflows"
  DROP CONSTRAINT "scheduling_workflows_hold_step_check",
  DROP CONSTRAINT "scheduling_workflows_appointment_step_check";

ALTER TABLE "scheduling_workflows"
  ADD CONSTRAINT "scheduling_workflows_hold_step_check" CHECK (
    "step" NOT IN ('WAITING_CONFIRMATION', 'WAITING_RESCHEDULE_CONFIRMATION') OR "hold_id" IS NOT NULL
  ),
  ADD CONSTRAINT "scheduling_workflows_type_step_check" CHECK (
    "step" IN ('IDENTIFY_PATIENT', 'COMPLETED', 'ABANDONED', 'FAILED', 'NEEDS_HUMAN', 'EXPIRED') OR
    ("workflow_type" = 'SCHEDULING' AND "step" IN ('IDENTIFY_SERVICE', 'COLLECT_PREFERENCES', 'SEARCH_SLOTS', 'SELECT_SLOT', 'WAITING_CONFIRMATION', 'APPOINTMENT_CREATED')) OR
    ("workflow_type" = 'CANCELLATION' AND "step" IN ('IDENTIFY_APPOINTMENT', 'WAITING_CANCELLATION_CONFIRMATION')) OR
    ("workflow_type" = 'RESCHEDULING' AND "step" IN ('IDENTIFY_APPOINTMENT', 'COLLECT_NEW_PREFERENCES', 'SEARCH_NEW_SLOTS', 'SELECT_NEW_SLOT', 'WAITING_RESCHEDULE_CONFIRMATION'))
  ),
  ADD CONSTRAINT "scheduling_workflows_result_check" CHECK (
    ("step" <> 'APPOINTMENT_CREATED' OR "appointment_id" IS NOT NULL) AND
    ("step" <> 'WAITING_CANCELLATION_CONFIRMATION' OR "target_appointment_id" IS NOT NULL) AND
    ("step" <> 'WAITING_RESCHEDULE_CONFIRMATION' OR ("target_appointment_id" IS NOT NULL AND "hold_id" IS NOT NULL)) AND
    ("step" <> 'COMPLETED' OR
      ("workflow_type" = 'SCHEDULING' AND "appointment_id" IS NOT NULL) OR
      ("workflow_type" = 'CANCELLATION' AND "target_appointment_id" IS NOT NULL) OR
      ("workflow_type" = 'RESCHEDULING' AND "target_appointment_id" IS NOT NULL AND "appointment_id" IS NOT NULL)
    )
  );

CREATE INDEX "scheduling_workflows_tenant_type_step_expiry_idx"
  ON "scheduling_workflows"("tenant_id", "workflow_type", "step", "expires_at");
CREATE INDEX "scheduling_workflows_tenant_target_appointment_idx"
  ON "scheduling_workflows"("tenant_id", "target_appointment_id");

ALTER TABLE "scheduling_workflows"
  ADD CONSTRAINT "scheduling_workflows_target_appointment_fkey"
  FOREIGN KEY ("tenant_id", "target_appointment_id")
  REFERENCES "appointments"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "scheduling_appointment_options" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "workflow_id" UUID NOT NULL,
  "option_number" INTEGER NOT NULL,
  "appointment_id" UUID NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scheduling_appointment_options_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "scheduling_appointment_options_number_check" CHECK ("option_number" > 0),
  CONSTRAINT "scheduling_appointment_options_expiry_check" CHECK ("created_at" < "expires_at")
);

CREATE UNIQUE INDEX "scheduling_appointment_options_tenant_workflow_number_key"
  ON "scheduling_appointment_options"("tenant_id", "workflow_id", "option_number");
CREATE UNIQUE INDEX "scheduling_appointment_options_tenant_workflow_appointment_key"
  ON "scheduling_appointment_options"("tenant_id", "workflow_id", "appointment_id");
CREATE INDEX "scheduling_appointment_options_tenant_workflow_expiry_idx"
  ON "scheduling_appointment_options"("tenant_id", "workflow_id", "expires_at");
CREATE INDEX "scheduling_appointment_options_tenant_appointment_idx"
  ON "scheduling_appointment_options"("tenant_id", "appointment_id");

ALTER TABLE "scheduling_appointment_options"
  ADD CONSTRAINT "scheduling_appointment_options_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "scheduling_appointment_options_workflow_fkey"
  FOREIGN KEY ("tenant_id", "workflow_id") REFERENCES "scheduling_workflows"("tenant_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT,
  ADD CONSTRAINT "scheduling_appointment_options_appointment_fkey"
  FOREIGN KEY ("tenant_id", "appointment_id") REFERENCES "appointments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
