-- ============================================================
-- 037_add_roommate_deleted_at.sql
-- Soft-delete support for roommate_profiles, mirroring 036 which
-- added deleted_at to users and ambassador_profiles.
-- Deactivation flips is_active = false and stamps deleted_at;
-- the record is retained for audit/referential integrity.
-- ============================================================

ALTER TABLE public.roommate_profiles
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_roommate_profiles_deleted_at
    ON public.roommate_profiles (deleted_at);
