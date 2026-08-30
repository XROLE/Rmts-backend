-- ============================================================
-- 019_profile_request_confirmation.sql
-- Tracks the welcome_to_roommate_ng confirmation template sent to
-- a freshly created profile's WhatsApp contact, and the user's
-- button reply.
--
--   welcome_sent_at     -> template dispatched (guard against resends)
--   welcome_confirmed_at -> user tapped "Yes, start matching"
--   welcome_declined_at  -> user tapped "No, I didn't request this"
--
-- A declined request flips is_active = false so the profile is never
-- matched (match.service only considers is_active = true profiles).
-- ============================================================

ALTER TABLE public.roommate_profiles
    ADD COLUMN welcome_sent_at TIMESTAMPTZ,
    ADD COLUMN welcome_confirmed_at TIMESTAMPTZ,
    ADD COLUMN welcome_declined_at TIMESTAMPTZ;