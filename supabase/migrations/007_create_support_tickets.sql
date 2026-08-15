-- ============================================================
-- 007_create_support_tickets.sql
-- User-submitted support tickets
-- ============================================================

-- ---------- public.support_tickets ----------
CREATE TABLE public.support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    message TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    email_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX idx_support_tickets_user_id
    ON public.support_tickets (user_id);

-- ---------- Row Level Security ----------
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

-- Users can create their own tickets.
CREATE POLICY "Users can insert their own tickets"
    ON public.support_tickets
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can read their own tickets.
CREATE POLICY "Users can read their own tickets"
    ON public.support_tickets
    FOR SELECT
    USING (auth.uid() = user_id);
