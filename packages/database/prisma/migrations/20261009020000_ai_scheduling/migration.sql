CREATE TYPE "SchedulingWorkflowStep" AS ENUM (
  'IDENTIFY_PATIENT',
  'IDENTIFY_SERVICE',
  'COLLECT_PREFERENCES',
  'SEARCH_SLOTS',
  'SELECT_SLOT',
  'WAITING_CONFIRMATION',
  'APPOINTMENT_CREATED',
  'COMPLETED',
  'ABANDONED',
  'FAILED',
  'NEEDS_HUMAN',
  'EXPIRED'
);

CREATE TYPE "SchedulingPeriod" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING', 'ANY');

ALTER TYPE "AuthEventType" ADD VALUE 'SCHEDULING_WORKFLOW_STARTED';
ALTER TYPE "AuthEventType" ADD VALUE 'SCHEDULING_WORKFLOW_UPDATED';
ALTER TYPE "AuthEventType" ADD VALUE 'SCHEDULING_WORKFLOW_COMPLETED';
ALTER TYPE "AuthEventType" ADD VALUE 'SCHEDULING_WORKFLOW_ABANDONED';
ALTER TYPE "AuthEventType" ADD VALUE 'SCHEDULING_WORKFLOW_HANDOFF';

ALTER TABLE "appointment_holds"
  ALTER COLUMN "creator_id" DROP NOT NULL,
  ADD COLUMN "created_by_type" "AppointmentActorType" NOT NULL DEFAULT 'USER';

CREATE UNIQUE INDEX "conversations_tenant_id_id_contact_id_key"
  ON "conversations"("tenant_id", "id", "contact_id");

CREATE TABLE "scheduling_workflows" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "contact_id" UUID NOT NULL,
  "patient_id" UUID,
  "specialty_id" UUID,
  "service_id" UUID,
  "provider_id" UUID,
  "unit_id" UUID,
  "preferred_date" DATE,
  "preferred_period" "SchedulingPeriod",
  "hold_id" UUID,
  "appointment_id" UUID,
  "step" "SchedulingWorkflowStep" NOT NULL DEFAULT 'IDENTIFY_PATIENT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scheduling_workflows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "scheduling_workflows_version_check" CHECK ("version" > 0),
  CONSTRAINT "scheduling_workflows_preference_check" CHECK (
    ("preferred_date" IS NULL) = ("preferred_period" IS NULL)
  ),
  CONSTRAINT "scheduling_workflows_hold_step_check" CHECK (
    "step" <> 'WAITING_CONFIRMATION' OR "hold_id" IS NOT NULL
  ),
  CONSTRAINT "scheduling_workflows_appointment_step_check" CHECK (
    "step" NOT IN ('APPOINTMENT_CREATED', 'COMPLETED') OR "appointment_id" IS NOT NULL
  )
);

CREATE TABLE "scheduling_slot_options" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "workflow_id" UUID NOT NULL,
  "option_number" INTEGER NOT NULL,
  "service_id" UUID NOT NULL,
  "provider_id" UUID NOT NULL,
  "unit_id" UUID NOT NULL,
  "start_at" TIMESTAMPTZ(3) NOT NULL,
  "end_at" TIMESTAMPTZ(3) NOT NULL,
  "timezone" VARCHAR(100) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scheduling_slot_options_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "scheduling_slot_options_number_check" CHECK ("option_number" > 0),
  CONSTRAINT "scheduling_slot_options_time_check" CHECK ("start_at" < "end_at"),
  CONSTRAINT "scheduling_slot_options_expiry_check" CHECK ("created_at" < "expires_at")
);

CREATE UNIQUE INDEX "scheduling_workflows_tenant_id_id_key" ON "scheduling_workflows"("tenant_id", "id");
CREATE UNIQUE INDEX "scheduling_workflows_tenant_id_conversation_id_key" ON "scheduling_workflows"("tenant_id", "conversation_id");
CREATE UNIQUE INDEX "scheduling_workflows_tenant_conversation_contact_key" ON "scheduling_workflows"("tenant_id", "conversation_id", "contact_id");
CREATE UNIQUE INDEX "scheduling_workflows_tenant_id_hold_id_key" ON "scheduling_workflows"("tenant_id", "hold_id");
CREATE UNIQUE INDEX "scheduling_workflows_tenant_id_appointment_id_key" ON "scheduling_workflows"("tenant_id", "appointment_id");
CREATE INDEX "scheduling_workflows_tenant_id_step_expires_at_idx" ON "scheduling_workflows"("tenant_id", "step", "expires_at");
CREATE INDEX "scheduling_workflows_tenant_id_patient_id_idx" ON "scheduling_workflows"("tenant_id", "patient_id");
CREATE INDEX "scheduling_workflows_tenant_id_service_id_idx" ON "scheduling_workflows"("tenant_id", "service_id");
CREATE UNIQUE INDEX "scheduling_slot_options_tenant_workflow_number_key" ON "scheduling_slot_options"("tenant_id", "workflow_id", "option_number");
CREATE INDEX "scheduling_slot_options_tenant_workflow_expiry_idx" ON "scheduling_slot_options"("tenant_id", "workflow_id", "expires_at");
CREATE INDEX "scheduling_slot_options_tenant_provider_unit_start_idx" ON "scheduling_slot_options"("tenant_id", "provider_id", "unit_id", "start_at");

ALTER TABLE "scheduling_workflows"
  ADD CONSTRAINT "scheduling_workflows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "scheduling_workflows_conversation_fkey" FOREIGN KEY ("tenant_id", "conversation_id", "contact_id") REFERENCES "conversations"("tenant_id", "id", "contact_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "scheduling_workflows_contact_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contacts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "scheduling_workflows_patient_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "scheduling_workflows_specialty_fkey" FOREIGN KEY ("tenant_id", "specialty_id") REFERENCES "specialties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "scheduling_workflows_service_fkey" FOREIGN KEY ("tenant_id", "service_id") REFERENCES "services"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "scheduling_workflows_provider_fkey" FOREIGN KEY ("tenant_id", "provider_id") REFERENCES "providers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "scheduling_workflows_unit_fkey" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "scheduling_workflows_hold_fkey" FOREIGN KEY ("tenant_id", "hold_id") REFERENCES "appointment_holds"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "scheduling_workflows_appointment_fkey" FOREIGN KEY ("tenant_id", "appointment_id") REFERENCES "appointments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "scheduling_slot_options"
  ADD CONSTRAINT "scheduling_slot_options_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "scheduling_slot_options_workflow_fkey" FOREIGN KEY ("tenant_id", "workflow_id") REFERENCES "scheduling_workflows"("tenant_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT,
  ADD CONSTRAINT "scheduling_slot_options_service_fkey" FOREIGN KEY ("tenant_id", "service_id") REFERENCES "services"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "scheduling_slot_options_provider_fkey" FOREIGN KEY ("tenant_id", "provider_id") REFERENCES "providers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "scheduling_slot_options_unit_fkey" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
