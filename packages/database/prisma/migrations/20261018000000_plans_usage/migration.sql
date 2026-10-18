CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIAL', 'GRACE', 'SUSPENDED', 'CANCELLED');

ALTER TYPE "AuthEventType" ADD VALUE 'PLAN_CHANGED';
ALTER TYPE "AuthEventType" ADD VALUE 'PLAN_UPGRADED';
ALTER TYPE "AuthEventType" ADD VALUE 'PLAN_DOWNGRADED';
ALTER TYPE "AuthEventType" ADD VALUE 'PLAN_OVERRIDE_CHANGED';
ALTER TYPE "AuthEventType" ADD VALUE 'SUBSCRIPTION_STATUS_CHANGED';
ALTER TYPE "AuthEventType" ADD VALUE 'GRACE_STARTED';
ALTER TYPE "AuthEventType" ADD VALUE 'GRACE_ENDED';

CREATE TABLE "tenant_subscriptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "plan_code" VARCHAR(32) NOT NULL DEFAULT 'BASIC',
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "current_period_start" TIMESTAMPTZ(3) NOT NULL,
  "current_period_end" TIMESTAMPTZ(3) NOT NULL,
  "grace_until" TIMESTAMPTZ(3),
  "scheduled_plan_code" VARCHAR(32),
  "overrides" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "tenant_subscriptions_period_check" CHECK ("current_period_start" < "current_period_end"),
  CONSTRAINT "tenant_subscriptions_plan_code_check" CHECK ("plan_code" IN ('BASIC', 'PRO', 'ENTERPRISE')),
  CONSTRAINT "tenant_subscriptions_scheduled_plan_check" CHECK ("scheduled_plan_code" IS NULL OR "scheduled_plan_code" IN ('BASIC', 'PRO', 'ENTERPRISE')),
  CONSTRAINT "tenant_subscriptions_overrides_object_check" CHECK (jsonb_typeof("overrides") = 'object')
);

CREATE UNIQUE INDEX "tenant_subscriptions_tenant_id_key" ON "tenant_subscriptions"("tenant_id");
CREATE INDEX "tenant_subscriptions_status_current_period_end_idx" ON "tenant_subscriptions"("status", "current_period_end");
CREATE INDEX "tenant_subscriptions_tenant_id_current_period_start_idx" ON "tenant_subscriptions"("tenant_id", "current_period_start");
CREATE INDEX "units_tenant_id_active_idx" ON "units"("tenant_id", "active");
CREATE INDEX "user_tenants_tenant_id_active_idx" ON "user_tenants"("tenant_id", "active");

INSERT INTO "tenant_subscriptions" ("tenant_id", "plan_code", "status", "current_period_start", "current_period_end")
SELECT "id", 'BASIC', 'ACTIVE',
  date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
  (date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '1 month') AT TIME ZONE 'UTC'
FROM "tenants";

CREATE FUNCTION create_default_tenant_subscription() RETURNS trigger AS $$
DECLARE
  period_start TIMESTAMPTZ;
BEGIN
  period_start := date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  INSERT INTO "tenant_subscriptions" ("tenant_id", "plan_code", "status", "current_period_start", "current_period_end")
  VALUES (NEW."id", 'BASIC', 'ACTIVE', period_start, period_start + INTERVAL '1 month');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_create_default_subscription
AFTER INSERT ON "tenants"
FOR EACH ROW EXECUTE FUNCTION create_default_tenant_subscription();
