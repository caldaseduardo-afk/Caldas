ALTER TYPE "AuthEventType" ADD VALUE 'PLATFORM_TENANT_ACCESS_STARTED';
ALTER TYPE "AuthEventType" ADD VALUE 'PLATFORM_TENANT_ACCESS_ENDED';
ALTER TYPE "AuthEventType" ADD VALUE 'PLATFORM_TENANT_ACCESS_READ';
ALTER TYPE "AuthEventType" ADD VALUE 'PLATFORM_TENANT_ACCESS_WRITE';
ALTER TYPE "AuditActorType" ADD VALUE 'PLATFORM_ADMIN';
ALTER TYPE "AuditSource" ADD VALUE 'PLATFORM';

CREATE TABLE "platform_tenant_accesses" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "token_hash" char(64) NOT NULL,
    "platform_session_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "tenant_id" uuid NOT NULL,
    "reason" varchar(500) NOT NULL,
    "created_at" timestamptz(3) NOT NULL DEFAULT now(),
    "expires_at" timestamptz(3) NOT NULL,
    "revoked_at" timestamptz(3),
    CONSTRAINT "platform_tenant_accesses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_tenant_accesses_time_check" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "platform_tenant_accesses_reason_check" CHECK (length(btrim("reason")) >= 10),
    CONSTRAINT "platform_tenant_accesses_platform_session_fkey" FOREIGN KEY ("platform_session_id") REFERENCES "platform_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "platform_tenant_accesses_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "platform_tenant_accesses_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "platform_tenant_accesses_token_hash_key" ON "platform_tenant_accesses"("token_hash");
CREATE UNIQUE INDEX "platform_tenant_accesses_one_open_per_session_idx" ON "platform_tenant_accesses"("platform_session_id") WHERE "revoked_at" IS NULL;
CREATE INDEX "platform_tenant_accesses_session_expiry_idx" ON "platform_tenant_accesses"("platform_session_id", "revoked_at", "expires_at");
CREATE INDEX "platform_tenant_accesses_tenant_created_idx" ON "platform_tenant_accesses"("tenant_id", "created_at");
CREATE INDEX "platform_tenant_accesses_user_created_idx" ON "platform_tenant_accesses"("user_id", "created_at");

ALTER TABLE "auth_events" DROP CONSTRAINT "audit_user_actor";
ALTER TABLE "auth_events" ADD CONSTRAINT "audit_user_actor" CHECK ((("actor_type" IN ('USER', 'PLATFORM_ADMIN')) AND "user_id" IS NOT NULL) OR (("actor_type" NOT IN ('USER', 'PLATFORM_ADMIN')) AND "user_id" IS NULL));
