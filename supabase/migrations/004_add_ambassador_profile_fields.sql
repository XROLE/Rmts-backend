-- ============================================================
-- 004_add_ambassador_profile_fields.sql
-- Extend ambassador_profiles with profile + social + bank detail
-- ============================================================

-- ---------- Enums ----------
CREATE TYPE user_verification_enum AS ENUM ('unverified', 'pending', 'verified', 'rejected');
CREATE TYPE ambassador_ranking_enum AS ENUM ('bronze', 'silver', 'gold', 'platinum', 'diamond');

-- ---------- New columns on ambassador_profiles ----------
ALTER TABLE public.ambassador_profiles
    ADD COLUMN profile_picture_url TEXT,
    ADD COLUMN verification_status user_verification_enum NOT NULL DEFAULT 'unverified',
    ADD COLUMN ambassador_ranking ambassador_ranking_enum NOT NULL DEFAULT 'bronze',
    ADD COLUMN state_covering TEXT[],
    ADD COLUMN emergency_contact JSONB,
    ADD COLUMN audience_category TEXT[],
    ADD COLUMN institution_or_organization VARCHAR(150),
    ADD COLUMN primary_operating VARCHAR(150),
    ADD COLUMN secondary_operating VARCHAR(150),
    ADD COLUMN social_media_platform TEXT[],
    ADD COLUMN social_media_handle VARCHAR(150),
    ADD COLUMN social_media_target_audience VARCHAR(150);