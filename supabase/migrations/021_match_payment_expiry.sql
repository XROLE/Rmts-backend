-- ============================================================
-- 021_match_payment_expiry.sql
-- Time-bound match service fee links.
--
-- When a match fee link is issued, payment_link_created_at records when.
-- The scheduler (MATCH_PAYMENT_SCHEDULER_INTERVAL_MIN) nudges a participant
-- MATCH_PAYMENT_NUDGE_BEFORE_HOURS (default 6h) before expiry, and expires
-- the link MATCH_PAYMENT_LINK_EXPIRY_HOURS (default 24h) after issuance,
-- cancelling the match if it is still unpaid.
-- ============================================================

ALTER TABLE public.match_participants
    ADD COLUMN payment_link_created_at TIMESTAMPTZ,
    ADD COLUMN nudge_sent_at TIMESTAMPTZ,
    ADD COLUMN expired_at TIMESTAMPTZ;

CREATE INDEX idx_match_participants_payment_due
    ON public.match_participants (payment_status, payment_link_created_at);