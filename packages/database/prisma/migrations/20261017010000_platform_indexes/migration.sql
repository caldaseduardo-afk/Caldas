CREATE INDEX conversations_platform_created_idx ON conversations(created_at);
CREATE INDEX messages_platform_created_idx ON messages(created_at);
CREATE INDEX appointments_platform_created_idx ON appointments(created_at);
CREATE INDEX ai_usage_platform_created_idx ON ai_usage(created_at);
CREATE INDEX tenants_platform_status_name_idx ON tenants(status,name,id);
