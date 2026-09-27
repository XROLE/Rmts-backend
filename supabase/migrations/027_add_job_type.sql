-- ============================================================
-- 027_add_job_type.sql
-- Distinguish paid vs volunteer roles on job postings, and make
-- the expected salary on applications optional (volunteer roles
-- do not require it).
-- ============================================================

CREATE TYPE job_type_enum AS ENUM (
    'paid',
    'volunteer'
);

ALTER TABLE public.job_postings
    ADD COLUMN job_type job_type_enum NOT NULL DEFAULT 'paid';

ALTER TABLE public.job_applications
    ALTER COLUMN expected_salary_ngn DROP NOT NULL;