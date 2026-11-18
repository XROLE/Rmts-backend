-- ============================================================
-- 042_job_postings_submission_platforms_array.sql
-- Stores multiple submission platforms per job posting as an
-- array of the existing enum values (serialized as string[]).
-- ============================================================

ALTER TABLE public.job_postings
    ALTER COLUMN submission_platform TYPE job_submission_platform_enum[]
    USING CASE
        WHEN submission_platform IS NULL THEN '{}'::job_submission_platform_enum[]
        ELSE ARRAY[submission_platform]::job_submission_platform_enum[]
    END,
    ALTER COLUMN submission_platform SET DEFAULT '{}'::job_submission_platform_enum[],
    ALTER COLUMN submission_platform SET NOT NULL;
