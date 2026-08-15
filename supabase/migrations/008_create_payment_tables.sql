-- ============================================================
-- 008_create_payment_tables.sql
-- Payment section: payment links, commissions, withdrawals
-- ============================================================

-- ---------- Enums ----------
CREATE TYPE payment_link_status_enum AS ENUM ('pending', 'paid', 'failed');
CREATE TYPE commission_status_enum AS ENUM ('pending', 'paid', 'failed');

-- ---------- public.payment_links ----------
-- A Paystack payment link issued to a roommate. Carries the ambassador's
-- referral code and is the trigger for a pending commission.
CREATE TABLE public.payment_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    roommate_profile_id UUID NOT NULL REFERENCES public.roommate_profiles(id) ON DELETE CASCADE,
    ambassador_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    referral_code VARCHAR(30) NOT NULL,
    amount_ngn NUMERIC(12, 2) NOT NULL,
    paystack_reference VARCHAR(100) UNIQUE,
    paystack_access_code VARCHAR(100),
    paystack_authorization_url TEXT,
    status payment_link_status_enum NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    paid_at TIMESTAMPTZ
);

CREATE INDEX idx_payment_links_ambassador
    ON public.payment_links (ambassador_user_id);
CREATE INDEX idx_payment_links_reference
    ON public.payment_links (paystack_reference);

-- ---------- public.commission_earnings ----------
-- One row per commission. Created as 'pending' when a payment link is
-- issued; flipped to 'paid' when Paystack confirms the roommate's payment.
CREATE TABLE public.commission_earnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ambassador_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    roommate_profile_id UUID NOT NULL REFERENCES public.roommate_profiles(id) ON DELETE CASCADE,
    payment_link_id UUID REFERENCES public.payment_links(id) ON DELETE SET NULL,
    amount_ngn NUMERIC(12, 2) NOT NULL,
    referral_code VARCHAR(30) NOT NULL,
    status commission_status_enum NOT NULL DEFAULT 'pending',
    paystack_reference VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    paid_at TIMESTAMPTZ
);

CREATE INDEX idx_commission_earnings_ambassador
    ON public.commission_earnings (ambassador_user_id);
CREATE INDEX idx_commission_earnings_reference
    ON public.commission_earnings (paystack_reference);

-- ---------- public.withdrawals ----------
-- A payout request from the ambassador's available balance.
CREATE TABLE public.withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ambassador_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    amount_ngn NUMERIC(12, 2) NOT NULL,
    status payout_status_enum NOT NULL DEFAULT 'pending',
    bank_code VARCHAR(20),
    bank_name VARCHAR(100),
    account_number VARCHAR(20),
    account_name VARCHAR(100),
    paystack_recipient_code VARCHAR(100),
    paystack_transfer_code VARCHAR(100),
    reference VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    processed_at TIMESTAMPTZ
);

CREATE INDEX idx_withdrawals_ambassador
    ON public.withdrawals (ambassador_user_id);

-- ---------- Ambassador balance columns ----------
ALTER TABLE public.ambassador_profiles
    ADD COLUMN available_balance_ngn NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    ADD COLUMN total_withdrawn_ngn NUMERIC(12, 2) NOT NULL DEFAULT 0.00;

-- ---------- Row Level Security ----------
ALTER TABLE public.payment_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;

-- Ambassadors read their own payment links.
CREATE POLICY "Ambassadors read own payment links"
    ON public.payment_links
    FOR SELECT
    USING (auth.uid() = ambassador_user_id);

-- Ambassadors read their own commissions.
CREATE POLICY "Ambassadors read own commissions"
    ON public.commission_earnings
    FOR SELECT
    USING (auth.uid() = ambassador_user_id);

-- Ambassadors read their own withdrawals.
CREATE POLICY "Ambassadors read own withdrawals"
    ON public.withdrawals
    FOR SELECT
    USING (auth.uid() = ambassador_user_id);

-- Ambassadors create their own withdrawals.
CREATE POLICY "Ambassadors create own withdrawals"
    ON public.withdrawals
    FOR INSERT
    WITH CHECK (auth.uid() = ambassador_user_id);
