ALTER TABLE "ai_processing_runs"
  DROP CONSTRAINT "ai_processing_runs_tenant_id_inbound_message_id_fkey",
  DROP CONSTRAINT "ai_processing_runs_tenant_id_response_message_id_fkey";

CREATE UNIQUE INDEX "messages_tenant_id_conversation_id_id_key"
  ON "messages"("tenant_id", "conversation_id", "id");
CREATE UNIQUE INDEX "ai_processing_runs_tenant_conversation_inbound_key"
  ON "ai_processing_runs"("tenant_id", "conversation_id", "inbound_message_id");
CREATE UNIQUE INDEX "ai_processing_runs_tenant_conversation_response_key"
  ON "ai_processing_runs"("tenant_id", "conversation_id", "response_message_id");

ALTER TABLE "ai_processing_runs"
  ADD CONSTRAINT "ai_processing_runs_tenant_conversation_inbound_fkey"
    FOREIGN KEY ("tenant_id", "conversation_id", "inbound_message_id")
    REFERENCES "messages"("tenant_id", "conversation_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ai_processing_runs_tenant_conversation_response_fkey"
    FOREIGN KEY ("tenant_id", "conversation_id", "response_message_id")
    REFERENCES "messages"("tenant_id", "conversation_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ai_processing_runs_counters_check"
    CHECK ("attempts" >= 0 AND "tool_calls" BETWEEN 0 AND 8),
  ADD CONSTRAINT "ai_processing_runs_completion_check"
    CHECK (
      ("status" IN ('PENDING', 'PROCESSING') AND "completed_at" IS NULL)
      OR ("status" IN ('COMPLETED', 'FAILED', 'SKIPPED') AND "completed_at" IS NOT NULL)
    );
