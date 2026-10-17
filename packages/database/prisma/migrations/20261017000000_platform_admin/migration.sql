ALTER TYPE "AuthEventType" ADD VALUE 'PLATFORM_ADMIN_GRANTED';
ALTER TYPE "AuthEventType" ADD VALUE 'PLATFORM_ADMIN_REVOKED';
ALTER TYPE "AuthEventType" ADD VALUE 'PLATFORM_MFA_ENROLLED';
ALTER TYPE "AuthEventType" ADD VALUE 'PLATFORM_LOGIN_SUCCEEDED';
ALTER TYPE "AuthEventType" ADD VALUE 'PLATFORM_LOGIN_FAILED';
ALTER TYPE "AuthEventType" ADD VALUE 'PLATFORM_LOGOUT';
ALTER TYPE "AuthEventType" ADD VALUE 'PLATFORM_TENANT_VIEWED';
CREATE TABLE platform_admins (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
 active boolean NOT NULL DEFAULT true, encrypted_secret text, enrolled_at timestamptz(3),
 last_step bigint NOT NULL DEFAULT -1, invite_hash char(64) UNIQUE, invite_expires_at timestamptz(3),
 created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(),
 CONSTRAINT platform_enrollment_check CHECK (enrolled_at IS NULL OR encrypted_secret IS NOT NULL)
);
CREATE TABLE platform_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 token_hash char(64) UNIQUE NOT NULL, verified_at timestamptz(3) NOT NULL DEFAULT now(), expires_at timestamptz(3) NOT NULL,
 CONSTRAINT platform_session_time CHECK (expires_at > verified_at)
);
CREATE INDEX platform_sessions_user_id_expires_at_idx ON platform_sessions(user_id, expires_at);
