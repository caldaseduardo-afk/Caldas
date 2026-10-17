ALTER TYPE "AuthEventType" ADD VALUE 'AI_CONFIG_VERSION_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'AI_CONFIG_VERSION_UPDATED';
ALTER TYPE "AuthEventType" ADD VALUE 'AI_CONFIG_PUBLISHED';
ALTER TYPE "AuthEventType" ADD VALUE 'AI_CONFIG_RESTORED';
ALTER TYPE "AuthEventType" ADD VALUE 'AI_CONFIG_SIMULATED';
CREATE TYPE "AIConfigurationVersionStatus" AS ENUM ('DRAFT','PUBLISHED','ARCHIVED');
CREATE TYPE "AITone" AS ENUM ('PROFESSIONAL','FRIENDLY','CONCISE','WARM','FORMAL','CUSTOM');
CREATE TYPE "AICapability" AS ENUM ('SCHEDULING','RESCHEDULING','CANCELLATION','KNOWLEDGE','HANDOFF');
CREATE TYPE "AIContentTopic" AS ENUM ('SCHEDULING','RESCHEDULING','CANCELLATION','CLINIC_INFORMATION','INSURANCE_INFORMATION','PAYMENT_INFORMATION','APPOINTMENT_PREPARATION');

CREATE TABLE "ai_configurations" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL, "active_version_id" UUID,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ai_configurations_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ai_configuration_versions" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL, "configuration_id" UUID NOT NULL,
 "version_number" INTEGER NOT NULL, "status" "AIConfigurationVersionStatus" NOT NULL DEFAULT 'DRAFT',
 "assistant_name" VARCHAR(80) NOT NULL, "tone" "AITone" NOT NULL DEFAULT 'PROFESSIONAL', "custom_tone" VARCHAR(500),
 "greeting" VARCHAR(500) NOT NULL, "system_instructions" VARCHAR(4000) NOT NULL,
 "allowed_content" "AIContentTopic"[] NOT NULL, "enabled_capabilities" "AICapability"[] NOT NULL,
 "knowledge_enabled" BOOLEAN NOT NULL DEFAULT true, "handoff_payment_negotiation" BOOLEAN NOT NULL DEFAULT true,
 "handoff_knowledge_miss" BOOLEAN NOT NULL DEFAULT true, "model" VARCHAR(128) NOT NULL,
 "temperature" DECIMAL(3,2), "max_output_tokens" INTEGER NOT NULL, "confidence_threshold" DECIMAL(3,2) NOT NULL,
 "based_on_version_id" UUID, "created_by_user_id" UUID NOT NULL, "updated_by_user_id" UUID NOT NULL,
 "published_by_user_id" UUID, "published_at" TIMESTAMPTZ(3),
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ai_configuration_versions_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ai_config_version_number_check" CHECK ("version_number" > 0),
 CONSTRAINT "ai_config_assistant_name_check" CHECK (char_length(btrim("assistant_name")) BETWEEN 1 AND 80),
 CONSTRAINT "ai_config_greeting_check" CHECK (char_length(btrim("greeting")) BETWEEN 1 AND 500),
 CONSTRAINT "ai_config_instructions_check" CHECK (char_length(btrim("system_instructions")) BETWEEN 1 AND 4000),
 CONSTRAINT "ai_config_custom_tone_check" CHECK (("tone"='CUSTOM' AND char_length(btrim("custom_tone")) BETWEEN 1 AND 500) OR ("tone"<>'CUSTOM' AND "custom_tone" IS NULL)),
 CONSTRAINT "ai_config_temperature_check" CHECK ("temperature" IS NULL OR ("temperature">=0 AND "temperature"<=2)),
 CONSTRAINT "ai_config_tokens_check" CHECK ("max_output_tokens" BETWEEN 64 AND 4096),
 CONSTRAINT "ai_config_confidence_check" CHECK ("confidence_threshold">=0 AND "confidence_threshold"<=1),
 CONSTRAINT "ai_config_capabilities_check" CHECK (cardinality("enabled_capabilities") BETWEEN 1 AND 5 AND "enabled_capabilities" <@ ARRAY['SCHEDULING','RESCHEDULING','CANCELLATION','KNOWLEDGE','HANDOFF']::"AICapability"[]),
 CONSTRAINT "ai_config_publication_check" CHECK (("status"='PUBLISHED' AND "published_by_user_id" IS NOT NULL AND "published_at" IS NOT NULL) OR "status"<>'PUBLISHED')
);
CREATE UNIQUE INDEX "ai_configurations_tenant_id_key" ON "ai_configurations"("tenant_id");
CREATE UNIQUE INDEX "ai_configurations_tenant_id_id_key" ON "ai_configurations"("tenant_id","id");
CREATE INDEX "ai_configurations_tenant_active_idx" ON "ai_configurations"("tenant_id","active_version_id");
CREATE UNIQUE INDEX "ai_configuration_versions_tenant_id_id_key" ON "ai_configuration_versions"("tenant_id","id");
CREATE UNIQUE INDEX "ai_config_versions_number_key" ON "ai_configuration_versions"("tenant_id","configuration_id","version_number");
CREATE UNIQUE INDEX "ai_config_one_draft" ON "ai_configuration_versions"("tenant_id","configuration_id") WHERE "status"='DRAFT';
CREATE INDEX "ai_config_versions_status_idx" ON "ai_configuration_versions"("tenant_id","configuration_id","status");
CREATE INDEX "ai_config_versions_published_idx" ON "ai_configuration_versions"("tenant_id","published_at");
CREATE INDEX "ai_config_versions_based_on_idx" ON "ai_configuration_versions"("tenant_id","based_on_version_id");
ALTER TABLE "ai_configurations" ADD CONSTRAINT "ai_configurations_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ai_configuration_versions" ADD CONSTRAINT "ai_config_versions_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ai_configuration_versions" ADD CONSTRAINT "ai_config_versions_configuration_fkey" FOREIGN KEY ("tenant_id","configuration_id") REFERENCES "ai_configurations"("tenant_id","id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ai_configuration_versions" ADD CONSTRAINT "ai_config_versions_based_on_fkey" FOREIGN KEY ("tenant_id","based_on_version_id") REFERENCES "ai_configuration_versions"("tenant_id","id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ai_configuration_versions" ADD CONSTRAINT "ai_config_versions_created_by_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ai_configuration_versions" ADD CONSTRAINT "ai_config_versions_updated_by_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ai_configuration_versions" ADD CONSTRAINT "ai_config_versions_published_by_fkey" FOREIGN KEY ("published_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ai_configurations" ADD CONSTRAINT "ai_configurations_active_version_fkey" FOREIGN KEY ("tenant_id","active_version_id") REFERENCES "ai_configuration_versions"("tenant_id","id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ai_processing_runs" ADD COLUMN "ai_configuration_version_id" UUID;
ALTER TABLE "ai_usage" ADD COLUMN "ai_configuration_version_id" UUID;
CREATE INDEX "ai_processing_runs_tenant_config_version_idx" ON "ai_processing_runs"("tenant_id","ai_configuration_version_id");
CREATE INDEX "ai_usage_tenant_config_version_idx" ON "ai_usage"("tenant_id","ai_configuration_version_id");
ALTER TABLE "ai_processing_runs" ADD CONSTRAINT "ai_processing_runs_config_version_fkey" FOREIGN KEY ("tenant_id","ai_configuration_version_id") REFERENCES "ai_configuration_versions"("tenant_id","id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_config_version_fkey" FOREIGN KEY ("tenant_id","ai_configuration_version_id") REFERENCES "ai_configuration_versions"("tenant_id","id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION validate_ai_active_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.active_version_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM ai_configuration_versions v WHERE v.id=NEW.active_version_id AND v.tenant_id=NEW.tenant_id AND v.configuration_id=NEW.id AND v.status='PUBLISHED'
 ) THEN RAISE EXCEPTION 'AI_ACTIVE_VERSION_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "ai_active_version_guard" AFTER INSERT OR UPDATE OF active_version_id ON "ai_configurations" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_ai_active_version();

INSERT INTO "permissions" ("name") VALUES ('settings.view'),('ai_config.publish') ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("role_name","permission_name")
SELECT role_name,permission_name FROM (VALUES ('CLINIC_ADMIN','settings.view'),('CLINIC_ADMIN','ai_config.publish')) AS grants(role_name,permission_name)
WHERE EXISTS (SELECT 1 FROM "roles" r WHERE r."name"=role_name) ON CONFLICT DO NOTHING;
