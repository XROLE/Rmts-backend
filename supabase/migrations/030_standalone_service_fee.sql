-- ============================================================
-- 030_standalone_service_fee.sql
-- Self-service "generate service-fee payment link" flow for Sido:
--   - sido_conversations gains a pending-payment-confirmation flag + code
--     so Sido can ask for a one-time code before issuing the link.
--   - transactions gains a `purpose` column so the Paystack webhook can tell
--     a standalone service-fee payment apart from a match-unlock payment and
--     fire the right fulfillment (emails + profile status).
-- ============================================================

-- ---------- sido_conversations: payment-confirmation state ----------
ALTER TABLE public.sido_conversations
    ADD COLUMN awaiting_payment_confirm BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN payment_confirm_code TEXT;

-- ---------- transactions: purpose discriminator ----------
ALTER TABLE public.transactions
    ADD COLUMN purpose TEXT NOT NULL DEFAULT 'match_fee';

CREATE INDEX idx_transactions_purpose ON public.transactions (purpose);
