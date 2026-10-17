-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('ACTIVE', 'DEGRADED', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "IntegrationType" AS ENUM ('WHATSAPP');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('WHATSAPP_CLOUD');

-- CreateEnum
CREATE TYPE "MessageDeliveryStatus" AS ENUM ('LOCAL', 'RECEIVED', 'PENDING', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuthEventType" ADD VALUE 'INTEGRATION_CONFIGURED';
ALTER TYPE "AuthEventType" ADD VALUE 'MESSAGE_SEND_REQUESTED';
ALTER TYPE "AuthEventType" ADD VALUE 'MESSAGE_SEND_SUCCEEDED';
ALTER TYPE "AuthEventType" ADD VALUE 'MESSAGE_SEND_FAILED';

-- DropIndex
DROP INDEX "messages_tenant_id_channel_provider_message_id_key";

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "integration_id" UUID;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "delivery_status" "MessageDeliveryStatus" NOT NULL DEFAULT 'LOCAL',
ADD COLUMN     "error_code" VARCHAR(64),
ADD COLUMN     "integration_id" UUID,
ADD COLUMN     "next_attempt_at" TIMESTAMPTZ(3),
ADD COLUMN     "recipient_address" VARCHAR(16),
ADD COLUMN     "request_id" UUID,
ADD COLUMN     "send_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sending_at" TIMESTAMPTZ(3),
ADD COLUMN     "sent_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "integrations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "type" "IntegrationType" NOT NULL DEFAULT 'WHATSAPP',
    "provider" "IntegrationProvider" NOT NULL DEFAULT 'WHATSAPP_CLOUD',
    "phone_number_id" VARCHAR(32) NOT NULL,
    "external_account_id" VARCHAR(32) NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "credentials_reference" VARCHAR(96) NOT NULL,
    "settings" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integrations_tenant_id_type_status_idx" ON "integrations"("tenant_id", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_tenant_id_id_key" ON "integrations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_provider_phone_number_id_key" ON "integrations"("provider", "phone_number_id");

-- CreateIndex
CREATE INDEX "messages_delivery_status_next_attempt_at_id_idx" ON "messages"("delivery_status", "next_attempt_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_tenant_id_integration_id_provider_message_id_key" ON "messages"("tenant_id", "integration_id", "provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_tenant_id_sender_user_id_request_id_key" ON "messages"("tenant_id", "sender_user_id", "request_id");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_integration_id_fkey" FOREIGN KEY ("tenant_id", "integration_id") REFERENCES "integrations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_integration_id_fkey" FOREIGN KEY ("tenant_id", "integration_id") REFERENCES "integrations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Preserve legacy idempotency while allowing independent configured phone numbers.
CREATE UNIQUE INDEX messages_legacy_provider_key ON messages(tenant_id,channel,provider_message_id) WHERE integration_id IS NULL;
DROP INDEX conversations_one_open_per_contact_channel;
CREATE UNIQUE INDEX conversations_one_open_per_contact_channel ON conversations(tenant_id,contact_id,channel)
 WHERE integration_id IS NULL AND status IN ('AI_ACTIVE','WAITING_PATIENT','NEEDS_HUMAN','HUMAN_ACTIVE');
CREATE UNIQUE INDEX conversations_one_open_per_integration ON conversations(tenant_id,contact_id,channel,integration_id)
 WHERE integration_id IS NOT NULL AND status IN ('AI_ACTIVE','WAITING_PATIENT','NEEDS_HUMAN','HUMAN_ACTIVE');
ALTER TABLE integrations ADD CONSTRAINT integrations_configuration_check CHECK (
 phone_number_id ~ '^[1-9][0-9]{4,31}$' AND external_account_id ~ '^[1-9][0-9]{4,31}$'
 AND credentials_reference ~ '^WHATSAPP_ACCESS_TOKEN_[A-Z][A-Z0-9_]{0,63}$'
 AND settings IS NULL);
ALTER TABLE messages ADD CONSTRAINT messages_send_check CHECK (
 send_attempts BETWEEN 0 AND 5
 AND (request_id IS NULL OR sender_type='USER')
 AND (delivery_status IN ('LOCAL','RECEIVED') OR
      (integration_id IS NOT NULL AND sender_type IN ('USER','AI') AND recipient_address ~ '^\+[1-9][0-9]{7,14}$'))
 AND (delivery_status<>'RECEIVED' OR (sender_type='PATIENT' AND provider_message_id IS NOT NULL AND integration_id IS NOT NULL))
 AND (delivery_status<>'PENDING' OR next_attempt_at IS NOT NULL)
 AND (delivery_status<>'SENDING' OR (sending_at IS NOT NULL AND send_attempts>0))
 AND (delivery_status NOT IN ('SENT','DELIVERED','READ') OR provider_message_id IS NOT NULL));
CREATE FUNCTION check_message_integration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM conversations WHERE tenant_id=NEW.tenant_id AND id=NEW.conversation_id AND integration_id IS NOT DISTINCT FROM NEW.integration_id) THEN
  RAISE EXCEPTION 'Message integration mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER messages_check_integration BEFORE INSERT OR UPDATE OF integration_id,tenant_id,conversation_id ON messages FOR EACH ROW EXECUTE FUNCTION check_message_integration();
CREATE FUNCTION preserve_conversation_integration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.integration_id IS DISTINCT FROM OLD.integration_id THEN
  RAISE EXCEPTION 'Conversation integration is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER conversations_preserve_integration BEFORE UPDATE OF integration_id ON conversations FOR EACH ROW EXECUTE FUNCTION preserve_conversation_integration();
