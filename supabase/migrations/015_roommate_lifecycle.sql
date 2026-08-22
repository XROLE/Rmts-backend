-- ============================================================
-- 015_roommate_lifecycle.sql
-- WhatsApp-led roommate lifecycle: phone-keyed onboarding,
-- match decisioning (PROPOSED -> ACCEPTED/REJECTED -> UNLOCKED)
-- and ₦2,000 unlock transactions keyed by Paystack reference.
--
-- Supersedes the two-roommate handover model in 014 (the
-- match_whatsapp_handovers table is no longer written to).
-- ============================================================

-- ---------- users: search lifecycle columns ----------
CREATE TYPE onboarding_status_enum AS ENUM ('PENDING', 'ACTIVE_SEARCH', 'OPTED_OUT');

ALTER TABLE public.users
    ADD COLUMN phone TEXT UNIQUE,
    ADD COLUMN search_active BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN onboarding_status onboarding_status_enum NOT NULL DEFAULT 'PENDING',
    ADD COLUMN rematch_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_users_phone ON public.users (phone);

-- ---------- public.matches ----------
-- One row per proposed pairing. user_phone is the roommate being notified;
-- candidate_id points at the candidate's identity row. flow_token ties the
-- WhatsApp Flow submission back to this match (unique + indexed).
CREATE TYPE match_lifecycle_status_enum AS ENUM (
    'PROPOSED', 'ACCEPTED', 'REJECTED', 'UNLOCKED'
);

CREATE TABLE public.matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_phone TEXT NOT NULL REFERENCES public.users(phone) ON DELETE CASCADE,
    candidate_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    compatibility_score INTEGER,
    status match_lifecycle_status_enum NOT NULL DEFAULT 'PROPOSED',
    rejection_reason TEXT,
    flow_token TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX idx_matches_user_phone ON public.matches (user_phone);
CREATE INDEX idx_matches_candidate ON public.matches (candidate_id);
CREATE INDEX idx_matches_flow_token ON public.matches (flow_token);
CREATE INDEX idx_matches_status ON public.matches (status);

DROP TRIGGER IF EXISTS trg_matches_updated_at ON public.matches;
CREATE TRIGGER trg_matches_updated_at
    BEFORE UPDATE ON public.matches
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- public.transactions ----------
-- One row per Paystack unlock payment. Keyed by the Paystack reference so
-- webhook processing is idempotent.
CREATE TYPE transaction_status_enum AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

CREATE TABLE public.transactions (
    reference TEXT PRIMARY KEY,
    user_phone TEXT NOT NULL,
    match_id UUID REFERENCES public.matches(id) ON DELETE SET NULL,
    amount NUMERIC(12, 2) NOT NULL,
    status transaction_status_enum NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    paid_at TIMESTAMPTZ
);

CREATE INDEX idx_transactions_match ON public.transactions (match_id);
CREATE INDEX idx_transactions_user_phone ON public.transactions (user_phone);

-- ---------- Candidate social handle ----------
-- Used for PII fulfillment after a successful unlock; nullable so it can be
-- omitted from the message when unknown.
ALTER TABLE public.roommate_profiles ADD COLUMN social_handle VARCHAR(100);

-- ---------- Row Level Security ----------
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Users read their own matches by phone.
CREATE POLICY "Users read own matches"
    ON public.matches
    FOR SELECT
    USING (auth.uid() IN (
        SELECT u.id FROM public.users u WHERE u.phone = user_phone
    ));

-- Users read their own transactions by phone.
CREATE POLICY "Users read own transactions"
    ON public.transactions
    FOR SELECT
    USING (auth.uid() IN (
        SELECT u.id FROM public.users u WHERE u.phone = user_phone
    ));
