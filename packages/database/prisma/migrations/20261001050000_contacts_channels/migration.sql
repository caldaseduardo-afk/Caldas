-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ContactChannelType" AS ENUM ('PHONE', 'WHATSAPP');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuthEventType" ADD VALUE 'CONTACT_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'CONTACT_UPDATED';
ALTER TYPE "AuthEventType" ADD VALUE 'CONTACT_CHANNEL_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'CONTACT_CHANNEL_UPDATED';

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" "ContactStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_channels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "type" "ContactChannelType" NOT NULL,
    "address" VARCHAR(16) NOT NULL,
    "provider_external_id" VARCHAR(200),
    "primary" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contacts_tenant_id_id_key" ON "contacts"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "contact_channels_tenant_id_address_idx" ON "contact_channels"("tenant_id", "address");

-- CreateIndex
CREATE INDEX "contact_channels_tenant_id_contact_id_idx" ON "contact_channels"("tenant_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_channels_tenant_type_address_key" ON "contact_channels"("tenant_id", "type", "address");

-- CreateIndex
CREATE UNIQUE INDEX "contact_channels_tenant_type_external_key" ON "contact_channels"("tenant_id", "type", "provider_external_id");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "contact_channels" ADD CONSTRAINT "contact_channels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "contact_channels" ADD CONSTRAINT "contact_channels_tenant_id_contact_id_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contacts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Garantia física: no máximo um canal principal por contato, inclusive sob concorrência.
CREATE UNIQUE INDEX "contact_channels_one_primary_key"
ON "contact_channels" ("tenant_id", "contact_id") WHERE "primary" = true;

-- Não aceitar endereços não canônicos em escritas que contornem a aplicação.
ALTER TABLE "contact_channels" ADD CONSTRAINT "contact_channels_address_canonical"
CHECK ("address" ~ '^\+[1-9][0-9]{7,14}$');
