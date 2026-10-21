-- ============================================================
-- 033_monthly_budget_range.sql
-- Replace the single monthly_apartment_requests.budget with a min/max range
-- so the notify message can show a budget band (e.g. ₦40,000 – ₦60,000/month).
-- ============================================================

ALTER TABLE public.monthly_apartment_requests
    DROP COLUMN budget,
    ADD COLUMN budget_min numeric NOT NULL CHECK (budget_min >= 0),
    ADD COLUMN budget_max numeric NOT NULL CHECK (budget_max >= budget_min);
