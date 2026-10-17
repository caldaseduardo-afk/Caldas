-- Preserve workflow history, while exposing only the Conversation mutation as business audit.
UPDATE auth_events SET is_business = false, resource_type = NULL WHERE type = 'SCHEDULING_WORKFLOW_HANDOFF';
