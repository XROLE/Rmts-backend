-- Co-renting interest on roommate profiles.
-- A user expresses interest by setting is_co_renting plus the details required
-- for the co-renters pool: their tribe, a short bio and their ideal flatmate.
-- Matching status defaults to 'active-search' and is transitioned by an admin.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'co_renting_matching_status') THEN
    CREATE TYPE co_renting_matching_status AS ENUM (
      'active-search',
      'pending-match',
      'matched'
    );
  END IF;
END
$$;

ALTER TABLE public.roommate_profiles
  ADD COLUMN IF NOT EXISTS is_co_renting BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.roommate_profiles
  ADD COLUMN IF NOT EXISTS tribe VARCHAR(100);

ALTER TABLE public.roommate_profiles
  ADD COLUMN IF NOT EXISTS ideal_flatmate_description TEXT;

ALTER TABLE public.roommate_profiles
  ADD COLUMN IF NOT EXISTS user_bio TEXT;

ALTER TABLE public.roommate_profiles
  ADD COLUMN IF NOT EXISTS co_renting_matching_status co_renting_matching_status
    NOT NULL DEFAULT 'active-search';

CREATE INDEX IF NOT EXISTS idx_roommate_profiles_co_renting
  ON public.roommate_profiles (is_co_renting);

CREATE INDEX IF NOT EXISTS idx_roommate_profiles_co_renting_status
  ON public.roommate_profiles (co_renting_matching_status);
