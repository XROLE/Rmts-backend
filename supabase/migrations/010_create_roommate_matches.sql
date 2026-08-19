-- ============================================================
-- 010_create_roommate_matches.sql
-- Persisted roommate matches: one row per confirmed pair.
-- Payment links reference the match and the matched partner so
-- the pairing is visible directly from the record.
-- ============================================================

-- ---------- Enums ----------
CREATE TYPE match_status_enum AS ENUM ('active', 'closed');

-- ---------- public.roommate_matches ----------
-- A confirmed pairing of two roommate profiles. Ids are stored ordered
-- (a < b) by the service so an unordered pair is unique. A profile may
-- have at most one active match (enforced by the partial unique indexes).
CREATE TABLE public.roommate_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    roommate_profile_a_id UUID NOT NULL REFERENCES public.roommate_profiles(id) ON DELETE CASCADE,
    roommate_profile_b_id UUID NOT NULL REFERENCES public.roommate_profiles(id) ON DELETE CASCADE,
    score NUMERIC(5, 2),
    breakdown JSONB,
    status match_status_enum NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT roommate_matches_distinct_profiles
        CHECK (roommate_profile_a_id <> roommate_profile_b_id)
);

-- Unordered pair uniqueness (ids are stored ordered a < b).
CREATE UNIQUE INDEX idx_roommate_matches_pair
    ON public.roommate_matches (roommate_profile_a_id, roommate_profile_b_id);

-- At most one active match per profile, regardless of which side it is on.
CREATE UNIQUE INDEX idx_roommate_matches_active_a
    ON public.roommate_matches (roommate_profile_a_id)
    WHERE status = 'active';
CREATE UNIQUE INDEX idx_roommate_matches_active_b
    ON public.roommate_matches (roommate_profile_b_id)
    WHERE status = 'active';

-- Lookups by either profile.
CREATE INDEX idx_roommate_matches_a
    ON public.roommate_matches (roommate_profile_a_id);
CREATE INDEX idx_roommate_matches_b
    ON public.roommate_matches (roommate_profile_b_id);

-- ---------- payment_links: reference the match + matched partner ----------
ALTER TABLE public.payment_links
    ADD COLUMN match_id UUID REFERENCES public.roommate_matches(id) ON DELETE SET NULL,
    ADD COLUMN matched_roommate_profile_id UUID REFERENCES public.roommate_profiles(id) ON DELETE SET NULL;

CREATE INDEX idx_payment_links_match
    ON public.payment_links (match_id);
CREATE INDEX idx_payment_links_matched_roommate
    ON public.payment_links (matched_roommate_profile_id);

-- ---------- Row Level Security ----------
ALTER TABLE public.roommate_matches ENABLE ROW LEVEL SECURITY;

-- Matched users can read their own matches (backend uses the service role
-- and bypasses RLS; this covers direct client-side reads).
CREATE POLICY "Roommates read own matches"
    ON public.roommate_matches
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.roommate_profiles rp
            WHERE rp.user_id = auth.uid()
              AND (rp.id = roommate_profile_a_id OR rp.id = roommate_profile_b_id)
        )
    );
