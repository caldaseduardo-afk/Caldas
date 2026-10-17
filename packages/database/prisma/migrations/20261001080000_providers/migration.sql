-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuthEventType" ADD VALUE 'PROVIDER_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'PROVIDER_UPDATED';
ALTER TYPE "AuthEventType" ADD VALUE 'PROVIDER_SERVICE_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'PROVIDER_SERVICE_UPDATED';
ALTER TYPE "AuthEventType" ADD VALUE 'PROVIDER_UNIT_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'PROVIDER_UNIT_UPDATED';

-- CreateTable
CREATE TABLE "providers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "professional_type" VARCHAR(80) NOT NULL,
    "registration_number" VARCHAR(120),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "duration_override_minutes" INTEGER,
    "price_override" DECIMAL(12,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_units" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_units_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "providers_tenant_id_active_idx" ON "providers"("tenant_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "providers_tenant_id_id_key" ON "providers"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "provider_services_tenant_id_provider_id_active_idx" ON "provider_services"("tenant_id", "provider_id", "active");

-- CreateIndex
CREATE INDEX "provider_services_tenant_id_service_id_active_idx" ON "provider_services"("tenant_id", "service_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "provider_services_tenant_id_provider_id_service_id_key" ON "provider_services"("tenant_id", "provider_id", "service_id");

-- CreateIndex
CREATE INDEX "provider_units_tenant_id_provider_id_active_idx" ON "provider_units"("tenant_id", "provider_id", "active");

-- CreateIndex
CREATE INDEX "provider_units_tenant_id_unit_id_active_idx" ON "provider_units"("tenant_id", "unit_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "provider_units_tenant_id_provider_id_unit_id_key" ON "provider_units"("tenant_id", "provider_id", "unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "services_tenant_id_id_key" ON "services"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "providers" ADD CONSTRAINT "providers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "provider_services" ADD CONSTRAINT "provider_services_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "provider_services" ADD CONSTRAINT "provider_services_tenant_id_provider_id_fkey" FOREIGN KEY ("tenant_id", "provider_id") REFERENCES "providers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "provider_services" ADD CONSTRAINT "provider_services_tenant_id_service_id_fkey" FOREIGN KEY ("tenant_id", "service_id") REFERENCES "services"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "provider_units" ADD CONSTRAINT "provider_units_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "provider_units" ADD CONSTRAINT "provider_units_tenant_id_provider_id_fkey" FOREIGN KEY ("tenant_id", "provider_id") REFERENCES "providers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "provider_units" ADD CONSTRAINT "provider_units_tenant_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Overrides ausentes permanecem null; invariantes também são protegidas no banco.
ALTER TABLE "provider_services" ADD CONSTRAINT "provider_services_duration_check"
CHECK ("duration_override_minutes" IS NULL OR "duration_override_minutes" > 0);
ALTER TABLE "provider_services" ADD CONSTRAINT "provider_services_price_check"
CHECK ("price_override" IS NULL OR ("price_override" >= 0 AND "price_override" <= 9999999999.99));
