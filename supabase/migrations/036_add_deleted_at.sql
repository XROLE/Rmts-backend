-- ============================================================
-- 036_add_deleted_at.sql
-- Soft-delete support for users and ambassador_profiles.
-- Deactivation flips is_active = false and stamps deleted_at;
-- the record is retained for audit/referential integrity.
-- ============================================================

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE public.ambassador_profiles
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_deleted_at
    ON public.users (deleted_at);

CREATE INDEX IF NOT EXISTS idx_ambassador_profiles_deleted_at
    ON public.ambassador_profiles (deleted_at);
