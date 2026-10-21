-- ============================================================
-- 032_monthly_payment_flow.sql
-- Adds the payment lifecycle for monthly shared-apartment requests:
--   - monthly_apartment_requests gains payment/decline tracking columns
--   - transactions gains a request_id so the Paystack webhook can tie a
--     'monthly_apartment_fee' charge back to the originating request and
--     fire the right fulfillment (no roommate pair is involved).
-- ============================================================

ALTER TABLE public.monthly_apartment_requests
    ADD COLUMN payment_reference text,
    ADD COLUMN payment_link_created_at timestamptz,
    ADD COLUMN paid_at timestamptz,
    ADD COLUMN declined_at timestamptz;

CREATE INDEX idx_monthly_apartment_requests_payment
    ON public.monthly_apartment_requests (payment_reference);

-- Link a fee transaction to the monthly request it was issued for.
ALTER TABLE public.transactions
    ADD COLUMN request_id UUID REFERENCES public.monthly_apartment_requests (id) ON DELETE SET NULL;

CREATE INDEX idx_transactions_request ON public.transactions (request_id);
