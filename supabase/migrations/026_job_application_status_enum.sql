-- ============================================================
-- 026_job_application_status_enum.sql
-- Enforce allowed job application statuses at the storage layer
-- instead of a free-text VARCHAR. The CREATE TYPE is guarded so
-- this migration can be re-run after a partial failure, and the
-- text DEFAULT is dropped before the cast so Postgres does not
-- error (42804) converting it to the enum type automatically.
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_application_status_enum') THEN
        CREATE TYPE job_application_status_enum AS ENUM (
            'new',
            'to-be-interviewed',
            'interviewed',
            'rejected',
            'archived',
            'offered'
        );
    END IF;
END $$;

ALTER TABLE public.job_applications
    ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.job_applications
    ALTER COLUMN status TYPE job_application_status_enum
    USING status::job_application_status_enum;

ALTER TABLE public.job_applications
    ALTER COLUMN status SET DEFAULT 'new';