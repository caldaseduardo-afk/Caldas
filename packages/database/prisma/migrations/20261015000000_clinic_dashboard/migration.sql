-- Range scans for bounded tenant dashboard aggregates; existing indexes cover
-- status, audit actions/resources and relational filters.
CREATE INDEX "appointments_tenant_id_start_at_idx" ON "appointments"("tenant_id", "start_at");
CREATE INDEX "messages_tenant_id_created_at_idx" ON "messages"("tenant_id", "created_at");
CREATE INDEX "human_sla_cycles_tenant_id_claimed_at_idx" ON "human_sla_cycles"("tenant_id", "claimed_at");
