-- CreateEnum
CREATE TYPE "ConversationChannel" AS ENUM ('WHATSAPP');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('AI_ACTIVE', 'WAITING_PATIENT', 'NEEDS_HUMAN', 'HUMAN_ACTIVE', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ConversationIntent" AS ENUM ('SCHEDULING', 'RESCHEDULING', 'CANCELLATION', 'CONFIRMATION', 'INFORMATION', 'PAYMENT', 'COMPLAINT', 'CLINICAL_QUESTION', 'OTHER');

-- CreateEnum
CREATE TYPE "HandoffReason" AS ENUM ('USER_REQUESTED_HUMAN', 'AI_LOW_CONFIDENCE', 'PAYMENT_NEGOTIATION', 'COMPLAINT', 'CLINICAL_QUESTION', 'AUTHORIZATION_PROBLEM', 'SCHEDULING_CONFLICT', 'SYSTEM_ERROR', 'OTHER');

-- CreateEnum
CREATE TYPE "MessageSenderType" AS ENUM ('PATIENT', 'AI', 'USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'AUDIO', 'DOCUMENT', 'LOCATION', 'CONTACT', 'INTERACTIVE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuthEventType" ADD VALUE 'CONVERSATION_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'CONVERSATION_UPDATED';
ALTER TYPE "AuthEventType" ADD VALUE 'CONVERSATION_STATUS_CHANGED';
ALTER TYPE "AuthEventType" ADD VALUE 'MESSAGE_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'MESSAGE_RECEIPT_UPDATED';

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "active_patient_id" UUID,
    "channel" "ConversationChannel" NOT NULL DEFAULT 'WHATSAPP',
    "status" "ConversationStatus" NOT NULL DEFAULT 'AI_ACTIVE',
    "intent" "ConversationIntent" NOT NULL DEFAULT 'OTHER',
    "assigned_user_id" UUID,
    "handoff_reason" "HandoffReason",
    "last_message_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "channel" "ConversationChannel" NOT NULL,
    "provider_message_id" VARCHAR(300),
    "sender_type" "MessageSenderType" NOT NULL,
    "sender_user_id" UUID,
    "message_type" "MessageType" NOT NULL,
    "content" VARCHAR(4000) NOT NULL DEFAULT '',
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_tenant_id_contact_id_status_idx" ON "conversations"("tenant_id", "contact_id", "status");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_active_patient_id_status_idx" ON "conversations"("tenant_id", "active_patient_id", "status");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_assigned_user_id_status_idx" ON "conversations"("tenant_id", "assigned_user_id", "status");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_intent_status_idx" ON "conversations"("tenant_id", "intent", "status");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_channel_last_message_at_idx" ON "conversations"("tenant_id", "channel", "last_message_at");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_created_at_idx" ON "conversations"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_tenant_id_id_key" ON "conversations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_tenant_id_id_channel_key" ON "conversations"("tenant_id", "id", "channel");

-- CreateIndex
CREATE INDEX "messages_tenant_id_conversation_id_created_at_id_idx" ON "messages"("tenant_id", "conversation_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "messages_tenant_id_sender_type_created_at_idx" ON "messages"("tenant_id", "sender_type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "messages_tenant_id_id_key" ON "messages"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_tenant_id_channel_provider_message_id_key" ON "messages"("tenant_id", "channel", "provider_message_id");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_contact_id_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contacts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_active_patient_id_fkey" FOREIGN KEY ("tenant_id", "active_patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_contact_id_active_patient_id_fkey" FOREIGN KEY ("tenant_id", "contact_id", "active_patient_id") REFERENCES "contact_patients"("tenant_id", "contact_id", "patient_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_user_id_tenant_id_fkey" FOREIGN KEY ("assigned_user_id", "tenant_id") REFERENCES "user_tenants"("user_id", "tenant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_conversation_id_channel_fkey" FOREIGN KEY ("tenant_id", "conversation_id", "channel") REFERENCES "conversations"("tenant_id", "id", "channel") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_tenant_id_fkey" FOREIGN KEY ("sender_user_id", "tenant_id") REFERENCES "user_tenants"("user_id", "tenant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;


CREATE UNIQUE INDEX conversations_one_open_per_contact_channel ON conversations(tenant_id,contact_id,channel)
 WHERE status IN ('AI_ACTIVE','WAITING_PATIENT','NEEDS_HUMAN','HUMAN_ACTIVE');
ALTER TABLE conversations ADD CONSTRAINT conversations_assignment_check CHECK (
 (status='HUMAN_ACTIVE' AND assigned_user_id IS NOT NULL) OR
 (status<>'HUMAN_ACTIVE' AND assigned_user_id IS NULL));
ALTER TABLE conversations ADD CONSTRAINT conversations_handoff_check CHECK (
 (status='NEEDS_HUMAN' AND handoff_reason IS NOT NULL) OR
 (status<>'NEEDS_HUMAN' AND handoff_reason IS NULL));
ALTER TABLE messages ADD CONSTRAINT messages_sender_check CHECK (
 (sender_type='USER' AND sender_user_id IS NOT NULL) OR
 (sender_type<>'USER' AND sender_user_id IS NULL));
ALTER TABLE messages ADD CONSTRAINT messages_receipts_check CHECK (
 isfinite(created_at)
 AND (delivered_at IS NULL OR (sender_type IN ('AI','USER') AND isfinite(delivered_at) AND delivered_at>=created_at))
 AND (read_at IS NULL OR (delivered_at IS NOT NULL AND isfinite(read_at) AND read_at>=delivered_at)));
ALTER TABLE messages ADD CONSTRAINT messages_content_check CHECK (
 (message_type='TEXT' AND length(btrim(content))>0 AND metadata IS NULL) OR
 (message_type<>'TEXT' AND metadata IS NOT NULL AND jsonb_typeof(metadata)='object' AND octet_length(metadata::text)<=4000
 AND NOT (metadata ?| ARRAY['data','binary','base64'])));
ALTER TABLE messages ADD CONSTRAINT messages_provider_id_check CHECK (provider_message_id IS NULL OR length(btrim(provider_message_id))>0);

-- Even direct SQL insertion updates last_message_at atomically. GREATEST also
-- preserves the maximum if an older imported event is inserted in the future.
CREATE FUNCTION update_conversation_last_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE conversations SET last_message_at=GREATEST(last_message_at,NEW.created_at),updated_at=clock_timestamp()
 WHERE tenant_id=NEW.tenant_id AND id=NEW.conversation_id;
 RETURN NEW;
END;
$$;
CREATE TRIGGER messages_update_last_message AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION update_conversation_last_message();
