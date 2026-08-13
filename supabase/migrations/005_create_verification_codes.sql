-- ============================================================
-- 005_create_verification_codes.sql
-- Email & WhatsApp contact verification (OTP)
-- ============================================================

-- ---------- Enum ----------
CREATE TYPE verification_channel_enum AS ENUM ('email', 'whatsapp');

-- ---------- public.verification_codes ----------
CREATE TABLE public.verification_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    channel verification_channel_enum NOT NULL,
    code VARCHAR(6) NOT NULL,
    target VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    attempts INT NOT NULL DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX idx_verification_codes_user_channel
    ON public.verification_codes (user_id, channel);

-- ---------- public.users verified flags ----------
ALTER TABLE public.users
    ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN whatsapp_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------- Row Level Security ----------
ALTER TABLE public.verification_codes ENABLE ROW LEVEL SECURITY;