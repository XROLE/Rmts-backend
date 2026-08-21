-- ============================================================
-- 012_whatsapp_handover.sql
-- WhatsApp bot handover for confirmed matches.
--
-- After an admin confirms a match, a WhatsApp Business Cloud API bot
-- drives a bounded interactive flow with both roommates:
--   1. Sanitized, non-PII profile card + Accept/Decline buttons
--   2. On decline -> close the match, both profiles return to 'rematch'
--   3. Only when BOTH accept -> generate a Paystack payment link for
--      each user and send it on WhatsApp
--
-- A match hands over exactly once (UNIQUE match_id) so retries are safe.
-- ============================================================

-- ---------- Enums ----------
CREATE TYPE whatsapp_handover_status_enum AS ENUM (
    'initiated',      -- handover row created, messages not yet sent
    'sent',           -- intro messages sent to both users
    'partial_accept', -- one user accepted, the other still pending
    'both_accepted',  -- both accepted, payment links being generated
    'payment_sent',   -- both payment links created and sent
    'declined',       -- one user declined, match closed
    'failed'          -- sending failed, admin can retry
);

CREATE TYPE whatsapp_user_response_enum AS ENUM ('pending', 'accepted', 'declined');

-- ---------- public.match_whatsapp_handovers ----------
-- Per-pair handover state. One row per match; both users identified by
-- profile id and WhatsApp number so inbound replies can be attributed
-- to the correct side.
CREATE TABLE public.match_whatsapp_handovers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL UNIQUE REFERENCES public.roommate_matches(id) ON DELETE CASCADE,
    status whatsapp_handover_status_enum NOT NULL DEFAULT 'initiated',
    user_a_profile_id UUID NOT NULL REFERENCES public.roommate_profiles(id) ON DELETE CASCADE,
    user_b_profile_id UUID NOT NULL REFERENCES public.roommate_profiles(id) ON DELETE CASCADE,
    user_a_phone TEXT NOT NULL,
    user_b_phone TEXT NOT NULL,
    user_a_response whatsapp_user_response_enum NOT NULL DEFAULT 'pending',
    user_b_response whatsapp_user_response_enum NOT NULL DEFAULT 'pending',
    user_a_responded_at TIMESTAMPTZ,
    user_b_responded_at TIMESTAMPTZ,
    user_a_wam_id TEXT,
    user_b_wam_id TEXT,
    payment_link_a_id UUID REFERENCES public.payment_links(id) ON DELETE SET NULL,
    payment_link_b_id UUID REFERENCES public.payment_links(id) ON DELETE SET NULL,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX idx_handovers_status
    ON public.match_whatsapp_handovers (status);

-- ---------- public.whatsapp_messages ----------
-- Audit log + inbound de-duplication. Every outbound message we send and
-- every inbound event Meta forwards is recorded; wam_id is the provider
-- message id, so duplicate webhook deliveries are ignored.
CREATE TABLE public.whatsapp_messages (
    wam_id TEXT PRIMARY KEY,
    match_id UUID REFERENCES public.roommate_matches(id) ON DELETE SET NULL,
    phone TEXT,
    direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
    message_type TEXT,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX idx_whatsapp_messages_match
    ON public.whatsapp_messages (match_id);

-- ---------- Row Level Security ----------
-- Backend uses the service-role client (bypasses RLS); policies cover
-- direct client-side reads only.
ALTER TABLE public.match_whatsapp_handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- Roommates can read handover state for their own matches.
CREATE POLICY "Roommates read own handovers"
    ON public.match_whatsapp_handovers
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.roommate_matches rm
            JOIN public.roommate_profiles rp
              ON rp.id IN (rm.roommate_profile_a_id, rm.roommate_profile_b_id)
            WHERE rm.id = match_id
              AND rp.user_id = auth.uid()
        )
    );