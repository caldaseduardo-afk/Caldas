-- Bound successor/completion probes for each historical workflow cycle.
CREATE INDEX "auth_events_tenant_id_resource_id_type_created_at_id_idx"
  ON "auth_events"("tenant_id", "resource_id", "type", "created_at", "id");
