-- ============================================================
-- 025_job_applications_user_id_nullable.sql
-- Allow anonymous job applications: user_id no longer required.
-- ============================================================

ALTER TABLE public.job_applications ALTER COLUMN user_id DROP NOT NULL;