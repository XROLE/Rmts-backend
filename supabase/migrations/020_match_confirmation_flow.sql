-- ============================================================
-- 020_match_confirmation_flow.sql
-- Two-user match confirmation + service-fee flow for admin-confirmed
-- matches (POST /matches -> roommate_matches).
--
-- When a match is confirmed, both matched roommates receive a WhatsApp
-- template (hello_world). Each user replies "yes" to accept, which
-- generates a Paystack payment link for the one-time service fee
-- (transactions). Once a user pays (paystack-webhook), that side of the
-- pair is marked paid and they are connected with the matched roommate.
--
-- match_participants ties each profile to its side of a match and its
-- payment state. transactions.participant_id lets the charge.success
-- webhook route to the pair flow instead of the legacy lifecycle flow.
-- ============================================================

CREATE TABLE public.match_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES public.roommate_matches(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES public.roommate_profiles(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    response TEXT NOT NULL DEFAULT 'pending' CHECK (response IN ('pending', 'accepted', 'declined')),
    payment_reference TEXT UNIQUE,
    payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid')),
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (match_id, profile_id)
);

CREATE INDEX idx_match_participants_phone
    ON public.match_participants (phone, payment_status);
CREATE INDEX idx_match_participants_match
    ON public.match_participants (match_id);

-- Route the charge.success webhook to the pair flow when set.
ALTER TABLE public.transactions
    ADD COLUMN participant_id UUID REFERENCES public.match_participants(id) ON DELETE SET NULL;

-- Backend uses the service-role client (bypasses RLS); no client policies.
ALTER TABLE public.match_participants ENABLE ROW LEVEL SECURITY;