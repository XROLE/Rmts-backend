-- ============================================================
-- 006_add_state_to_roommate_profiles.sql
-- Add a state column to roommate_profiles. The NOT NULL DEFAULT
-- backfills every existing row with 'lagos' in the same statement.
-- ============================================================

ALTER TABLE public.roommate_profiles
    ADD COLUMN state VARCHAR(100) NOT NULL DEFAULT 'lagos';
