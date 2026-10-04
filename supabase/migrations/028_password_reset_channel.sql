-- ============================================================
-- 028_password_reset_channel.sql
-- Forgot-password flow: store reset OTPs in verification_codes
-- under a dedicated channel value.
-- ============================================================

ALTER TYPE verification_channel_enum ADD VALUE IF NOT EXISTS 'password_reset';