-- ============================================================
-- 024_fix_job_posting_migration.sql
-- Recovery for 023 paths that failed partway ("cannot drop column
-- status ... policy job_postings_select_open depends on it").
--
-- When 023 is run in a per-statement fashion, the enum types and the
-- ADD COLUMN block land before the Failing DROP COLUMN, leaving a table
-- that has BOTH the legacy and the new columns. This migration completes
-- the rework in an idempotent way (every statement is guarded), so it is
-- safe to run whether or not a previous 023 attempt already applied.
-- ============================================================

-- Drop the 022 policy that depends on the status column BEFORE retiring it.
DROP POLICY IF EXISTS job_postings_select_open ON public.job_postings;

-- Retire the legacy free-text/search fields.
ALTER TABLE public.job_postings
    DROP COLUMN IF EXISTS position,
    DROP COLUMN IF EXISTS salary_range_ngn,
    DROP COLUMN IF EXISTS status;

-- Salary range guard (recreate idempotently).
ALTER TABLE public.job_postings
    DROP CONSTRAINT IF EXISTS chk_job_postings_salary_range;

ALTER TABLE public.job_postings
    ADD CONSTRAINT chk_job_postings_salary_range
    CHECK (salary_max IS NULL OR salary_min IS NULL OR salary_max >= salary_min);

-- Indexes (recreate idempotently).
DROP INDEX IF EXISTS idx_job_postings_is_active;
CREATE INDEX idx_job_postings_is_active ON public.job_postings (is_active);

DROP INDEX IF EXISTS idx_job_postings_closing_date;
CREATE INDEX idx_job_postings_closing_date ON public.job_postings (closing_date);

-- Public read is gated on is_active = TRUE.
DROP POLICY IF EXISTS job_postings_select_active ON public.job_postings;
CREATE POLICY job_postings_select_active
    ON public.job_postings
    FOR SELECT
    USING (is_active = TRUE);