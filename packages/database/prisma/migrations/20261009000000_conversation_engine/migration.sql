CREATE TYPE "AIProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'SKIPPED');

ALTER TYPE "AuthEventType" ADD VALUE 'CONVERSATION_ENGINE_STARTED';
ALTER TYPE "AuthEventType" ADD VALUE 'CONVERSATION_ENGINE_COMPLETED';
ALTER TYPE "AuthEventType" ADD VALUE 'CONVERSATION_ENGINE_FAILED';
ALTER TYPE "AuthEventType" ADD VALUE 'CONVERSATION_ENGINE_HANDOFF';

ALTER TABLE "conversations"
  ADD COLUMN "ai_summary" VARCHAR(2000),
  ADD COLUMN "ai_summary_updated_at" TIMESTAMPTZ(3);

CREATE TABLE "ai_processing_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "inbound_message_id" UUID NOT NULL,
  "response_message_id" UUID,
  "correlation_id" UUID NOT NULL,
  "status" "AIProcessingStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "tool_calls" INTEGER NOT NULL DEFAULT 0,
  "error_code" VARCHAR(64),
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "next_dispatch_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_processing_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversation_engine_leases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversation_engine_leases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_processing_runs_tenant_id_id_key" ON "ai_processing_runs"("tenant_id", "id");
CREATE UNIQUE INDEX "ai_processing_runs_tenant_id_inbound_message_id_key" ON "ai_processing_runs"("tenant_id", "inbound_message_id");
CREATE UNIQUE INDEX "ai_processing_runs_tenant_id_response_message_id_key" ON "ai_processing_runs"("tenant_id", "response_message_id");
CREATE INDEX "ai_processing_runs_status_next_dispatch_at_created_at_id_idx" ON "ai_processing_runs"("status", "next_dispatch_at", "created_at", "id");
CREATE INDEX "ai_processing_runs_tenant_id_conversation_id_status_created_at_id_idx" ON "ai_processing_runs"("tenant_id", "conversation_id", "status", "created_at", "id");
CREATE UNIQUE INDEX "conversation_engine_leases_tenant_id_conversation_id_key" ON "conversation_engine_leases"("tenant_id", "conversation_id");
CREATE INDEX "conversation_engine_leases_expires_at_idx" ON "conversation_engine_leases"("expires_at");

ALTER TABLE "ai_processing_runs" ADD CONSTRAINT "ai_processing_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ai_processing_runs" ADD CONSTRAINT "ai_processing_runs_tenant_id_conversation_id_fkey" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "conversations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ai_processing_runs" ADD CONSTRAINT "ai_processing_runs_tenant_id_inbound_message_id_fkey" FOREIGN KEY ("tenant_id", "inbound_message_id") REFERENCES "messages"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ai_processing_runs" ADD CONSTRAINT "ai_processing_runs_tenant_id_response_message_id_fkey" FOREIGN KEY ("tenant_id", "response_message_id") REFERENCES "messages"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "conversation_engine_leases" ADD CONSTRAINT "conversation_engine_leases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "conversation_engine_leases" ADD CONSTRAINT "conversation_engine_leases_tenant_id_conversation_id_fkey" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "conversations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
