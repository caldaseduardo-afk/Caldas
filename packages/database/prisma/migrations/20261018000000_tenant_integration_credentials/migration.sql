CREATE TABLE "ai_provider_credentials" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "nonce" VARCHAR(32) NOT NULL,
  "auth_tag" VARCHAR(32) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_provider_credentials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_provider_credentials_tenant_id_key" UNIQUE ("tenant_id"),
  CONSTRAINT "ai_provider_credentials_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE RESTRICT
);

ALTER TABLE "integrations"
  ADD COLUMN "credential_ciphertext" TEXT,
  ADD COLUMN "credential_nonce" VARCHAR(32),
  ADD COLUMN "credential_auth_tag" VARCHAR(32);

ALTER TABLE "integrations" ADD CONSTRAINT "integrations_credential_envelope_check"
  CHECK (("credential_ciphertext" IS NULL AND "credential_nonce" IS NULL AND "credential_auth_tag" IS NULL)
      OR ("credential_ciphertext" IS NOT NULL AND "credential_nonce" IS NOT NULL AND "credential_auth_tag" IS NOT NULL));
