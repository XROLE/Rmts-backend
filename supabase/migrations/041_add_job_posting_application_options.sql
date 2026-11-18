-- ============================================================
-- 041_add_job_posting_application_options.sql
-- Adds per-posting controls for hiring-process visibility, CV and
-- notice-period collection, plus the applicant submission platform.
-- ============================================================

CREATE TYPE job_submission_platform_enum AS ENUM (
    'LinkedIn',
    'GitHub',
    'Portfolio',
    'Twitter (X)',
    'TikTok',
    'Instagram',
    'Facebook',
    'Snapchat'
);

ALTER TABLE public.job_postings
    ADD COLUMN show_hiring_process BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN accept_cv BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN accept_notice_period BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN submission_platform job_submission_platform_enum;

-- Applications may omit a CV and/or notice period when the posting opts out.
ALTER TABLE public.job_applications
    ALTER COLUMN resume_url DROP NOT NULL,
    ALTER COLUMN notice_period DROP NOT NULL;
