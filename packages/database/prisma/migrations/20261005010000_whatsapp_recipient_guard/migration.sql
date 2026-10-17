-- SQL CHECK accepts UNKNOWN: explicitly reject NULL for outbound destinations.
-- Separate additive migration because the provider migration has already been applied.
ALTER TABLE messages ADD CONSTRAINT messages_outbound_recipient_check CHECK (
 delivery_status IN ('LOCAL','RECEIVED') OR recipient_address IS NOT NULL
);
