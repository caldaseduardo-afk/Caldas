-- CreateTable
CREATE TABLE "tool_executions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "patient_id" UUID,
    "actor_type" VARCHAR(8) NOT NULL,
    "actor_id" UUID NOT NULL,
    "correlation_id" UUID NOT NULL,
    "tool_name" VARCHAR(64) NOT NULL,
    "call_id" VARCHAR(100) NOT NULL,
    "input_hash" CHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'RUNNING',
    "result" JSONB,
    "error_code" VARCHAR(40),
    "target_id" UUID,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "tool_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tool_executions_tenant_id_created_at_idx" ON "tool_executions"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "tool_executions_tenant_id_correlation_id_idx" ON "tool_executions"("tenant_id", "correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "tool_executions_tenant_id_conversation_id_call_id_key" ON "tool_executions"("tenant_id", "conversation_id", "call_id");

-- AddForeignKey
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_tenant_id_conversation_id_fkey" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "conversations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_tenant_id_contact_id_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contacts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_execution_state_check" CHECK (
 actor_type IN ('AI', 'USER') AND input_hash ~ '^[0-9a-f]{64}$' AND
 ((status = 'RUNNING' AND completed_at IS NULL AND duration_ms IS NULL AND error_code IS NULL AND result IS NULL) OR
  (status = 'SUCCESS' AND completed_at IS NOT NULL AND duration_ms IS NOT NULL AND duration_ms >= 0 AND error_code IS NULL) OR
  (status = 'ERROR' AND completed_at IS NOT NULL AND duration_ms IS NOT NULL AND duration_ms >= 0 AND error_code IS NOT NULL))
);
