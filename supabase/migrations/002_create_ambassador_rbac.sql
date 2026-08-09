-- ============================================================
-- 002_create_ambassador_rbac.sql
-- Ambassador & RBAC subsystem: roles, base identity, referrals
-- ============================================================

-- ---------- Enums & Types ----------
CREATE TYPE user_role_enum AS ENUM ('user', 'ambassador', 'admin', 'super_admin');
CREATE TYPE payout_status_enum AS ENUM ('pending', 'processing', 'paid', 'failed');

-- ---------- public.users (Base Identity & Roles) ----------
CREATE TABLE public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    whatsapp_number VARCHAR(20) NOT NULL,
    role user_role_enum NOT NULL DEFAULT 'user',
    is_active BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX idx_users_role ON public.users (role);

-- ---------- public.ambassador_profiles ----------
CREATE TABLE public.ambassador_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    referral_code VARCHAR(30) UNIQUE NOT NULL,
    total_referrals INT NOT NULL DEFAULT 0,
    total_earnings_ngn NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    pending_balance_ngn NUMERIC(12, 2) NOT NULL DEFAULT 0.00,

    bank_code VARCHAR(20),
    bank_name VARCHAR(100),
    account_number VARCHAR(20),
    account_name VARCHAR(100),

    campus_or_region VARCHAR(100),
    is_approved BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX idx_ambassador_profiles_referral_code ON public.ambassador_profiles (referral_code);

-- ---------- updated_at auto-maintenance ----------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_ambassador_profiles_updated_at ON public.ambassador_profiles;
CREATE TRIGGER trg_ambassador_profiles_updated_at
    BEFORE UPDATE ON public.ambassador_profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- Row Level Security ----------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ambassador_profiles ENABLE ROW LEVEL SECURITY;