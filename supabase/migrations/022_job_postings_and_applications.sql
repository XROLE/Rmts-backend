-- ============================================================
-- 022_job_postings_and_applications.sql
-- Career subsystem: job postings (super-admin managed) and
-- job applications (authenticated users apply, resume via R2).
-- ============================================================

-- ---------- is_super_admin() helper ----------
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid()
          AND role = 'super_admin'
    );
$$;

-- ---------- public.job_postings ----------
CREATE TABLE public.job_postings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(150) NOT NULL,
    description TEXT NOT NULL,
    location VARCHAR(100) NOT NULL,
    position VARCHAR(100) NOT NULL,
    salary_range_ngn VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX idx_job_postings_status ON public.job_postings (status);

DROP TRIGGER IF EXISTS trg_job_postings_updated_at ON public.job_postings;
CREATE TRIGGER trg_job_postings_updated_at
    BEFORE UPDATE ON public.job_postings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- public.job_applications ----------
CREATE TABLE public.job_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    job_posting_id UUID REFERENCES public.job_postings(id) ON DELETE SET NULL,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    location VARCHAR(100) NOT NULL,
    position VARCHAR(100) NOT NULL,
    github_url TEXT,
    linkedin_url TEXT,
    resume_url TEXT NOT NULL,
    cover_note TEXT NOT NULL,
    notice_period VARCHAR(100) NOT NULL,
    expected_salary_ngn NUMERIC(14, 2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'new',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX idx_job_applications_user_id ON public.job_applications (user_id);
CREATE INDEX idx_job_applications_job_posting_id
    ON public.job_applications (job_posting_id);
CREATE INDEX idx_job_applications_status ON public.job_applications (status);

-- ---------- Row Level Security: job_postings ----------
ALTER TABLE public.job_postings ENABLE ROW LEVEL SECURITY;

-- Any visitor can read open postings.
CREATE POLICY job_postings_select_open
    ON public.job_postings
    FOR SELECT
    USING (status = 'open');

-- Only super admins can insert job postings.
CREATE POLICY job_postings_insert_super_admin
    ON public.job_postings
    FOR INSERT
    WITH CHECK (public.is_super_admin());

-- Only super admins can update job postings.
CREATE POLICY job_postings_update_super_admin
    ON public.job_postings
    FOR UPDATE
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- Only super admins can delete job postings.
CREATE POLICY job_postings_delete_super_admin
    ON public.job_postings
    FOR DELETE
    USING (public.is_super_admin());

-- ---------- Row Level Security: job_applications ----------
ALTER TABLE public.job_applications ENABLE ROW LEVEL SECURITY;

-- An applicant can submit an application for their own user id.
CREATE POLICY job_applications_insert_own
    ON public.job_applications
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- An applicant can read their own applications.
CREATE POLICY job_applications_select_own
    ON public.job_applications
    FOR SELECT
    USING (auth.uid() = user_id);

-- Super admins can read all applications.
CREATE POLICY job_applications_select_super_admin
    ON public.job_applications
    FOR SELECT
    USING (public.is_super_admin());