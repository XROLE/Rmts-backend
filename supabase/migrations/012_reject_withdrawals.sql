-- ============================================================
-- 012_reject_withdrawals.sql
-- Adds a dedicated 'rejected' withdrawal status plus the reason
-- recorded when an admin rejects a withdrawal request.
-- ============================================================

ALTER TYPE payout_status_enum ADD VALUE 'rejected';

ALTER TABLE public.withdrawals
    ADD COLUMN rejection_reason TEXT;
