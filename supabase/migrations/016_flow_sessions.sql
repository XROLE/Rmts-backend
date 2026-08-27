-- ============================================================
-- 016_flow_sessions.sql
-- Session mapping for the WhatsApp Flows Data Exchange endpoint.
--
-- When WhatsApp Flows submission is delivered via a Data Exchange
-- endpoint (the flow JSON's top-level "endpoint"), the request body
-- only carries { flow_id, flow_token, endpoint_request_id, data } —
-- it does NOT include the sender's phone number. This table maps a
-- flow_token back to the phone the flow was sent to, so the backend
-- can attribute registration / onboarding / match submissions to the
-- originating user.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.flow_sessions (
    flow_token TEXT PRIMARY KEY,
    phone TEXT NOT NULL,
    flow_id TEXT,
    screen TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_touched_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flow_sessions_phone ON public.flow_sessions (phone);
CREATE INDEX IF NOT EXISTS idx_flow_sessions_flow_id ON public.flow_sessions (flow_id);

-- ---------- Row Level Security ----------
ALTER TABLE public.flow_sessions ENABLE ROW LEVEL SECURITY;

-- Users may read their own flow sessions by phone.
CREATE POLICY "Users read own flow sessions"
    ON public.flow_sessions
    FOR SELECT
    USING (auth.uid() IN (
        SELECT u.id FROM public.users u WHERE u.phone = phone
    ));
