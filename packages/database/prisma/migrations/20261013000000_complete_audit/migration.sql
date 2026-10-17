CREATE TYPE "AuditActorType" AS ENUM ('USER', 'AI', 'SYSTEM', 'AUTOMATION', 'INTEGRATION', 'IMPORT');
CREATE TYPE "AuditSource" AS ENUM ('WEB', 'API', 'WHATSAPP', 'AI_ENGINE', 'WORKER', 'GOOGLE_CALENDAR', 'SYSTEM', 'IMPORT');
CREATE TYPE "AuditResourceType" AS ENUM ('TENANT', 'UNIT', 'USER', 'CONTACT', 'CONTACT_CHANNEL', 'PATIENT', 'CONTACT_PATIENT', 'SPECIALTY', 'SERVICE', 'PROVIDER', 'AVAILABILITY_RULE', 'SCHEDULE_EXCEPTION', 'APPOINTMENT_HOLD', 'APPOINTMENT', 'CONVERSATION', 'NOTIFICATION_RULE', 'HUMAN_SLA_RULE', 'KNOWLEDGE_ARTICLE', 'AI_CONFIGURATION', 'INTEGRATION');
ALTER TABLE auth_events
 ADD COLUMN is_business BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN actor_type "AuditActorType" NOT NULL DEFAULT 'SYSTEM',
 ADD COLUMN actor_reference_id VARCHAR(128),
 ADD COLUMN source "AuditSource" NOT NULL DEFAULT 'SYSTEM',
 ADD COLUMN resource_type "AuditResourceType",
 ADD COLUMN previous_values JSONB,
 ADD COLUMN new_values JSONB,
 ADD COLUMN metadata JSONB,
 ADD COLUMN correlation_id UUID;
-- Preserve historical payloads. Provenance not recorded historically is not invented.
UPDATE auth_events SET actor_type = 'USER' WHERE user_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'TENANT' WHERE type = 'TENANT_CREATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'TENANT' WHERE type = 'TENANT_UPDATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'TENANT' WHERE type = 'TENANT_DEACTIVATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'USER' WHERE type = 'TENANT_MEMBERSHIP_GRANTED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'UNIT' WHERE type = 'UNIT_CREATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'UNIT' WHERE type = 'UNIT_UPDATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'UNIT' WHERE type = 'UNIT_DEACTIVATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'AI_CONFIGURATION' WHERE type = 'AI_CONFIG_VERSION_CREATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'AI_CONFIGURATION' WHERE type = 'AI_CONFIG_VERSION_UPDATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'AI_CONFIGURATION' WHERE type = 'AI_CONFIG_PUBLISHED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'AI_CONFIGURATION' WHERE type = 'AI_CONFIG_RESTORED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'KNOWLEDGE_ARTICLE' WHERE type = 'KNOWLEDGE_ARTICLE_CREATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'KNOWLEDGE_ARTICLE' WHERE type = 'KNOWLEDGE_ARTICLE_UPDATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'KNOWLEDGE_ARTICLE' WHERE type = 'KNOWLEDGE_ARTICLE_PUBLISHED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'KNOWLEDGE_ARTICLE' WHERE type = 'KNOWLEDGE_ARTICLE_INACTIVATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'NOTIFICATION_RULE' WHERE type = 'NOTIFICATION_RULE_CREATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'NOTIFICATION_RULE' WHERE type = 'NOTIFICATION_RULE_UPDATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'APPOINTMENT' WHERE type = 'APPOINTMENT_CREATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'APPOINTMENT' WHERE type = 'APPOINTMENT_CONFIRMED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'APPOINTMENT' WHERE type = 'APPOINTMENT_CANCELLED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'APPOINTMENT' WHERE type = 'APPOINTMENT_RESCHEDULED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'APPOINTMENT' WHERE type = 'APPOINTMENT_CHECKED_IN' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'APPOINTMENT' WHERE type = 'APPOINTMENT_COMPLETED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'APPOINTMENT' WHERE type = 'APPOINTMENT_NO_SHOW' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'APPOINTMENT_HOLD' WHERE type = 'HOLD_CREATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'APPOINTMENT_HOLD' WHERE type = 'HOLD_RELEASED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'APPOINTMENT_HOLD' WHERE type = 'HOLD_EXPIRED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'AVAILABILITY_RULE' WHERE type = 'AVAILABILITY_RULE_CREATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'AVAILABILITY_RULE' WHERE type = 'AVAILABILITY_RULE_UPDATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'SCHEDULE_EXCEPTION' WHERE type = 'SCHEDULE_EXCEPTION_CREATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'SCHEDULE_EXCEPTION' WHERE type = 'SCHEDULE_EXCEPTION_UPDATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'PROVIDER' WHERE type = 'PROVIDER_CREATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'PROVIDER' WHERE type = 'PROVIDER_UPDATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'PROVIDER' WHERE type = 'PROVIDER_SERVICE_CREATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'PROVIDER' WHERE type = 'PROVIDER_SERVICE_UPDATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'PROVIDER' WHERE type = 'PROVIDER_UNIT_CREATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'PROVIDER' WHERE type = 'PROVIDER_UNIT_UPDATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'SPECIALTY' WHERE type = 'SPECIALTY_CREATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'SPECIALTY' WHERE type = 'SPECIALTY_UPDATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'SERVICE' WHERE type = 'SERVICE_CREATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'SERVICE' WHERE type = 'SERVICE_UPDATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'CONTACT' WHERE type = 'CONTACT_CREATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'CONTACT' WHERE type = 'CONTACT_UPDATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'CONTACT_CHANNEL' WHERE type = 'CONTACT_CHANNEL_CREATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'CONTACT_CHANNEL' WHERE type = 'CONTACT_CHANNEL_UPDATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'PATIENT' WHERE type = 'PATIENT_CREATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'PATIENT' WHERE type = 'PATIENT_UPDATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'CONTACT_PATIENT' WHERE type = 'CONTACT_PATIENT_CREATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'CONTACT_PATIENT' WHERE type = 'CONTACT_PATIENT_UPDATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'CONTACT_PATIENT' WHERE type = 'CONTACT_PATIENT_REVOKED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'CONVERSATION' WHERE type = 'HUMAN_HANDOFF_REQUESTED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'CONVERSATION' WHERE type = 'CONVERSATION_CLAIMED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'CONVERSATION' WHERE type = 'CONVERSATION_TRANSFERRED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'CONVERSATION' WHERE type = 'CONVERSATION_RETURNED_TO_AI' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'CONVERSATION' WHERE type = 'CONVERSATION_RESOLVED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'CONVERSATION' WHERE type = 'CONVERSATION_CREATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'CONVERSATION' WHERE type = 'CONVERSATION_UPDATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'CONVERSATION' WHERE type = 'CONVERSATION_STATUS_CHANGED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'CONVERSATION' WHERE type = 'CONVERSATION_ENGINE_HANDOFF' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'CONVERSATION' WHERE type = 'SCHEDULING_WORKFLOW_HANDOFF' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'HUMAN_SLA_RULE' WHERE type = 'HUMAN_SLA_RULE_CREATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'HUMAN_SLA_RULE' WHERE type = 'HUMAN_SLA_RULE_UPDATED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'INTEGRATION' WHERE type = 'INTEGRATION_CONFIGURED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
UPDATE auth_events SET is_business = true, resource_type = 'INTEGRATION' WHERE type = 'CALENDAR_INTEGRATION_CONFIGURED' AND tenant_id IS NOT NULL AND resource_id IS NOT NULL;
ALTER TABLE auth_events ADD CONSTRAINT audit_business_context CHECK (NOT is_business OR (tenant_id IS NOT NULL AND resource_id IS NOT NULL AND resource_type IS NOT NULL));
ALTER TABLE auth_events ADD CONSTRAINT audit_user_actor CHECK ((actor_type = 'USER' AND user_id IS NOT NULL) OR (actor_type <> 'USER' AND user_id IS NULL));
CREATE INDEX auth_events_tenant_id_created_at_id_idx ON auth_events (tenant_id, created_at DESC, id DESC);
CREATE INDEX auth_events_tenant_id_resource_type_resource_id_idx ON auth_events (tenant_id, resource_type, resource_id);
CREATE INDEX auth_events_tenant_id_type_idx ON auth_events (tenant_id, type);
CREATE INDEX auth_events_tenant_id_user_id_idx ON auth_events (tenant_id, user_id);
CREATE INDEX auth_events_tenant_id_source_idx ON auth_events (tenant_id, source);
CREATE INDEX auth_events_correlation_id_idx ON auth_events (correlation_id);
INSERT INTO permissions (name) VALUES ('audit.view') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_name, permission_name) SELECT 'CLINIC_ADMIN', 'audit.view' WHERE EXISTS (SELECT 1 FROM roles WHERE name = 'CLINIC_ADMIN') ON CONFLICT DO NOTHING;
