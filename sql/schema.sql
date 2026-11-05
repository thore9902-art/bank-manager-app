-- Run in pgAdmin Query Tool connected to bank_manager_auth.
CREATE TABLE IF NOT EXISTS public.app_users (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 username VARCHAR(50) UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 role VARCHAR(20) NOT NULL CHECK (role IN ('MASTER','MANAGER')),
 is_active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.user_permissions (
 user_id BIGINT PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE,
 can_view BOOLEAN NOT NULL DEFAULT FALSE,
 can_add BOOLEAN NOT NULL DEFAULT FALSE,
 can_edit BOOLEAN NOT NULL DEFAULT FALSE,
 can_delete BOOLEAN NOT NULL DEFAULT FALSE,
 can_restore BOOLEAN NOT NULL DEFAULT FALSE,
 can_export BOOLEAN NOT NULL DEFAULT FALSE,
 can_view_audit BOOLEAN NOT NULL DEFAULT FALSE,
 can_manage_users BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS public.auth_audit (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id BIGINT REFERENCES public.app_users(id) ON DELETE SET NULL,
 action TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.user_sessions (
 sid VARCHAR NOT NULL PRIMARY KEY,
 sess JSON NOT NULL,
 expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expire ON public.user_sessions(expire);
-- For an existing bank_manager_app role, execute as database owner:
GRANT USAGE ON SCHEMA public TO bank_manager_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_users, public.user_permissions, public.auth_audit, public.user_sessions TO bank_manager_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bank_manager_app;
