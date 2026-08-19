-- ============================================================
-- 011_add_ambassador_recipient_code.sql
-- Stores the ambassador's reusable Paystack transfer recipient
-- so withdrawals do not need to re-create it on every request.
-- ============================================================

ALTER TABLE public.ambassador_profiles
    ADD COLUMN paystack_recipient_code VARCHAR(100);
