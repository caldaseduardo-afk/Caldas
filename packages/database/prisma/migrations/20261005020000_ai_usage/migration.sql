-- CreateTable
CREATE TABLE "ai_usage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "model" VARCHAR(128) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "total_tokens" INTEGER,
    "estimated_cost" DECIMAL(20,10),
    "latency_ms" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_code" VARCHAR(40),
    "correlation_id" UUID NOT NULL,
    "provider_request_id" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_usage_tenant_id_created_at_idx" ON "ai_usage"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_tenant_id_correlation_id_idx" ON "ai_usage"("tenant_id", "correlation_id");

-- CreateIndex
CREATE INDEX "ai_usage_provider_model_created_at_idx" ON "ai_usage"("provider", "model", "created_at");

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Consumption is metadata, never a prompt archive. Unknown counts remain NULL.
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_counts_check" CHECK (
  (input_tokens IS NULL AND output_tokens IS NULL AND total_tokens IS NULL) OR
  (input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND total_tokens IS NOT NULL
   AND input_tokens >= 0 AND output_tokens >= 0 AND total_tokens >= 0
   AND total_tokens::bigint = input_tokens::bigint + output_tokens::bigint)
);
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_state_check" CHECK (
  attempts BETWEEN 0 AND 4 AND (estimated_cost IS NULL OR estimated_cost >= 0) AND
  ((status = 'PENDING' AND completed_at IS NULL AND latency_ms IS NULL AND error_code IS NULL AND attempts = 0) OR
   (status = 'SUCCESS' AND completed_at IS NOT NULL AND latency_ms IS NOT NULL AND latency_ms >= 0 AND error_code IS NULL AND attempts > 0) OR
   (status = 'ERROR' AND completed_at IS NOT NULL AND latency_ms IS NOT NULL AND latency_ms >= 0 AND error_code IS NOT NULL))
);
