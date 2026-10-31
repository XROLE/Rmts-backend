-- Add 'active' as a lifecycle state so an admin can reactivate a
-- paused/suspended roommate profile.
--
-- Postgres cannot add enum values to a type that backs a column default
-- cleanly inside the migration runner, so we follow the repo pattern in
-- 009_update_profile_status_enum.sql and 034_add_profile_paused_suspended.sql:
-- build a new enum with all values, migrate the data, drop the old type,
-- then rename.

DROP TYPE IF EXISTS profile_status_enum_new;
CREATE TYPE profile_status_enum_new AS ENUM (
  'new',
  'matched',
  'pending_payment',
  'paid',
  'rematch',
  'paused',
  'suspended',
  'active'
);

ALTER TABLE public.roommate_profiles ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.roommate_profiles
  ALTER COLUMN status TYPE profile_status_enum_new
  USING status::text::profile_status_enum_new;

DROP TYPE profile_status_enum;
ALTER TYPE profile_status_enum_new RENAME TO profile_status_enum;

ALTER TABLE public.roommate_profiles
  ALTER COLUMN status SET DEFAULT 'new'::profile_status_enum;
