-- ============================================================
-- 023_job_posting_columns.sql
-- Enrich job_postings with structured role fields (department,
-- employment type, experience level, work mode, salary, etc.).
-- Applies on top of 022.
-- ============================================================

-- ---------- Enums ----------
CREATE TYPE job_department_enum AS ENUM (
    'Engineering',
    'Operations',
    'Growth & Marketing',
    'Product & Design'
);

CREATE TYPE job_employment_type_enum AS ENUM (
    'full-time',
    'part-time',
    'contract',
    'internship'
);

CREATE TYPE job_experience_level_enum AS ENUM (
    'intern',
    'junior',
    'mid-level',
    'senior',
    'lead',
    'manager'
);

CREATE TYPE job_work_mode_enum AS ENUM (
    'onsite',
    'hybrid',
    'remote'
);

CREATE TYPE job_currency_enum AS ENUM (
    'USD',
    'NGN'
);

-- ---------- job_postings column rework ----------
ALTER TABLE public.job_postings
    ADD COLUMN department job_department_enum NOT NULL,
    ADD COLUMN employment_type job_employment_type_enum NOT NULL,
    ADD COLUMN experience_level job_experience_level_enum NOT NULL,
    ADD COLUMN work_mode job_work_mode_enum NOT NULL,
    ADD COLUMN salary_min NUMERIC(14, 2),
    ADD COLUMN salary_max NUMERIC(14, 2),
    ADD COLUMN currency job_currency_enum NOT NULL DEFAULT 'NGN',
    ADD COLUMN show_salary BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN requirements TEXT[] NOT NULL,
    ADD COLUMN nice_to_haves TEXT[],
    ADD COLUMN benefits TEXT[],
    ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN closing_date TIMESTAMPTZ;

-- Retire the legacy free-text/search fields replaced by the structured ones.
-- The old job_postings_select_open policy (from 022) depends on the status
-- column, so it must be dropped BEFORE the column is removed.
DROP POLICY IF EXISTS job_postings_select_open ON public.job_postings;

ALTER TABLE public.job_postings
    DROP COLUMN IF EXISTS position,
    DROP COLUMN IF EXISTS salary_range_ngn,
    DROP COLUMN IF EXISTS status;

-- A posting must not advertise a max lower than its min.
ALTER TABLE public.job_postings
    ADD CONSTRAINT chk_job_postings_salary_range
    CHECK (salary_max IS NULL OR salary_min IS NULL OR salary_max >= salary_min);

CREATE INDEX idx_job_postings_is_active ON public.job_postings (is_active);
CREATE INDEX idx_job_postings_closing_date ON public.job_postings (closing_date);

-- ---------- Row Level Security ----------
-- Previously public read was gated on status = 'open'; switch to is_active.
CREATE POLICY job_postings_select_active
    ON public.job_postings
    FOR SELECT
    USING (is_active = TRUE);