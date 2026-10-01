-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuthEventType" ADD VALUE 'SPECIALTY_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'SPECIALTY_UPDATED';
ALTER TYPE "AuthEventType" ADD VALUE 'SERVICE_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'SERVICE_UPDATED';

-- CreateTable
CREATE TABLE "specialties" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "specialties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "specialty_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "duration_minutes" INTEGER NOT NULL,
    "buffer_before_minutes" INTEGER NOT NULL DEFAULT 0,
    "buffer_after_minutes" INTEGER NOT NULL DEFAULT 0,
    "price" DECIMAL(12,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "specialties_tenant_id_active_idx" ON "specialties"("tenant_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "specialties_tenant_id_id_key" ON "specialties"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "specialties_tenant_id_name_key" ON "specialties"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "services_tenant_id_active_idx" ON "services"("tenant_id", "active");

-- CreateIndex
CREATE INDEX "services_tenant_id_specialty_id_active_idx" ON "services"("tenant_id", "specialty_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "services_tenant_id_specialty_id_name_key" ON "services"("tenant_id", "specialty_id", "name");

-- AddForeignKey
ALTER TABLE "specialties" ADD CONSTRAINT "specialties_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_tenant_id_specialty_id_fkey" FOREIGN KEY ("tenant_id", "specialty_id") REFERENCES "specialties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Invariantes também protegidas contra escrita direta no banco.
ALTER TABLE "services" ADD CONSTRAINT "services_duration_check" CHECK ("duration_minutes" > 0);
ALTER TABLE "services" ADD CONSTRAINT "services_buffers_check" CHECK ("buffer_before_minutes" >= 0 AND "buffer_after_minutes" >= 0);
ALTER TABLE "services" ADD CONSTRAINT "services_price_check" CHECK ("price" IS NULL OR ("price" >= 0 AND "price" <= 9999999999.99));
