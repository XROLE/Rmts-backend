-- ============================================================
-- 043_ambassador_social_media_handle_text.sql
-- Social media handles are now profile links, so widen the column
-- beyond the old 150-character username limit. Existing values are
-- left untouched.
-- ============================================================

ALTER TABLE public.ambassador_profiles
    ALTER COLUMN social_media_handle TYPE TEXT;
