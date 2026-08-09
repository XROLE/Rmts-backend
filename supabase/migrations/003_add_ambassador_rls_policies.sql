-- ============================================================
-- 003_add_ambassador_rls_policies.sql
-- Row Level Security policies for authenticated ambassadors.
--
-- Without policies, RLS blocks the authenticated role from reading
-- anything. This is especially visible in auth flows: after
-- signInWithPassword() the client switches to the 'authenticated'
-- role, so service-role queries no longer apply.
-- ============================================================

-- users: an authenticated user may read/update their own account row.
DROP POLICY IF EXISTS users_select_own ON public.users;
CREATE POLICY users_select_own
    ON public.users
    FOR SELECT
    USING (auth.uid() = id);

DROP POLICY IF EXISTS users_update_own ON public.users;
CREATE POLICY users_update_own
    ON public.users
    FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- ambassador_profiles: an ambassador may read/update their own profile.
DROP POLICY IF EXISTS ambassador_profiles_select_own ON public.ambassador_profiles;
CREATE POLICY ambassador_profiles_select_own
    ON public.ambassador_profiles
    FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS ambassador_profiles_update_own ON public.ambassador_profiles;
CREATE POLICY ambassador_profiles_update_own
    ON public.ambassador_profiles
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);