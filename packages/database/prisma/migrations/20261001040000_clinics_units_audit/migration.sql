-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuthEventType" ADD VALUE 'TENANT_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'TENANT_UPDATED';
ALTER TYPE "AuthEventType" ADD VALUE 'TENANT_DEACTIVATED';
ALTER TYPE "AuthEventType" ADD VALUE 'UNIT_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'UNIT_UPDATED';
ALTER TYPE "AuthEventType" ADD VALUE 'UNIT_DEACTIVATED';

-- AlterTable
ALTER TABLE "auth_events" ADD COLUMN     "changes" JSONB,
ADD COLUMN     "resource_id" UUID;

