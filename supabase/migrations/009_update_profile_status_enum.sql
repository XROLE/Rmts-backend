-- Reset all existing roommate profile statuses to 'new'.
UPDATE public.roommate_profiles
SET status = 'new'
WHERE status IS DISTINCT FROM 'new';

-- Postgres cannot drop enum values in place, so build the trimmed enum as a
-- new type, migrate the data, drop the old type, then rename.
DROP TYPE IF EXISTS profile_status_enum_new;
CREATE TYPE profile_status_enum_new AS ENUM (
  'new',
  'matched',
  'pending_payment',
  'paid',
  'rematch'
);

-- The column has a DEFAULT that cannot be auto-cast, so drop it first and
-- re-add it afterwards.
ALTER TABLE public.roommate_profiles ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.roommate_profiles
  ALTER COLUMN status TYPE profile_status_enum_new
  USING status::text::profile_status_enum_new;

DROP TYPE profile_status_enum;
ALTER TYPE profile_status_enum_new RENAME TO profile_status_enum;

ALTER TABLE public.roommate_profiles
  ALTER COLUMN status SET DEFAULT 'new'::profile_status_enum;