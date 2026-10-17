-- Additive migration; historical migrations remain unchanged.
ALTER TYPE "AuthEventType" ADD VALUE 'HUMAN_HANDOFF_REQUESTED';
ALTER TYPE "AuthEventType" ADD VALUE 'CONVERSATION_CLAIMED';
ALTER TYPE "AuthEventType" ADD VALUE 'CONVERSATION_TRANSFERRED';
ALTER TYPE "AuthEventType" ADD VALUE 'CONVERSATION_RETURNED_TO_AI';
ALTER TYPE "AuthEventType" ADD VALUE 'CONVERSATION_RESOLVED';
ALTER TABLE "conversations"
  ADD COLUMN "handoff_requested_at" TIMESTAMPTZ(3),
  ADD COLUMN "assigned_at" TIMESTAMPTZ(3),
  ADD COLUMN "resolved_at" TIMESTAMPTZ(3);
-- Legacy timestamps: last matching transition audit, otherwise updated_at approximation.
UPDATE "conversations" c SET
  handoff_requested_at = CASE WHEN status IN ('NEEDS_HUMAN', 'HUMAN_ACTIVE') THEN
    COALESCE((SELECT max(a.created_at) FROM auth_events a WHERE a.tenant_id=c.tenant_id
      AND a.resource_id=c.id AND a.type='CONVERSATION_STATUS_CHANGED'
      AND a.changes->>'to'='NEEDS_HUMAN'), c.updated_at) END,
  assigned_at = CASE WHEN status='HUMAN_ACTIVE' THEN
    COALESCE((SELECT max(a.created_at) FROM auth_events a WHERE a.tenant_id=c.tenant_id
      AND a.resource_id=c.id AND a.type='CONVERSATION_STATUS_CHANGED'
      AND a.changes->>'to'='HUMAN_ACTIVE'), c.updated_at) END,
  resolved_at = CASE WHEN status IN ('RESOLVED','CLOSED') THEN
    COALESCE((SELECT max(a.created_at) FROM auth_events a WHERE a.tenant_id=c.tenant_id
      AND a.resource_id=c.id AND a.type='CONVERSATION_STATUS_CHANGED'
      AND a.changes->>'to'='RESOLVED'), c.updated_at) END;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_handoff_timestamps_check" CHECK (
  (status <> 'NEEDS_HUMAN' OR handoff_requested_at IS NOT NULL)
  AND ((status = 'HUMAN_ACTIVE') = (assigned_at IS NOT NULL))
  AND ((status IN ('RESOLVED','CLOSED')) = (resolved_at IS NOT NULL))
);
CREATE INDEX "conversations_human_queue_idx"
 ON "conversations"("tenant_id", "status", "handoff_requested_at", "id");
