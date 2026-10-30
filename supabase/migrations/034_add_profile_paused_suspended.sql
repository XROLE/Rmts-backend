-- Add 'paused' and 'suspended' lifecycle states to roommate_profiles.
--
-- Postgres cannot add enum values to a type that backs a column default
-- cleanly inside the migration runner, so we follow the repo pattern in
-- 009_update_profile_status_enum.sql: build a new enum with all values,
-- migrate the data, drop the old type, then rename.

DROP TYPE IF EXISTS profile_status_enum_new;
CREATE TYPE profile_status_enum_new AS ENUM (
  'new',
  'matched',
  'pending_payment',
  'paid',
  'rematch',
  'paused',
  'suspended'
);

ALTER TABLE public.roommate_profiles ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.roommate_profiles
  ALTER COLUMN status TYPE profile_status_enum_new
  USING status::text::profile_status_enum_new;

DROP TYPE profile_status_enum;
ALTER TYPE profile_status_enum_new RENAME TO profile_status_enum;

ALTER TABLE public.roommate_profiles
  ALTER COLUMN status SET DEFAULT 'new'::profile_status_enum;

-- Audit timestamps + reason for the new paused/suspended lifecycle states.
ALTER TABLE public.roommate_profiles ADD COLUMN IF NOT EXISTS paused_at timestamptz;
ALTER TABLE public.roommate_profiles ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE public.roommate_profiles ADD COLUMN IF NOT EXISTS status_reason text;
