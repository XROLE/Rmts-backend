CREATE TABLE IF NOT EXISTS public.co_renting_match_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  credits_total INTEGER NOT NULL DEFAULT 7,
  credits_remaining INTEGER NOT NULL DEFAULT 0,
  matches_used INTEGER NOT NULL DEFAULT 0,
  payment_reference TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT co_renting_credits_non_negative
    CHECK (credits_remaining >= 0 AND matches_used >= 0 AND credits_remaining <= credits_total)
);

CREATE TABLE IF NOT EXISTS public.co_renting_connection_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  requester_profile_id UUID NOT NULL REFERENCES public.roommate_profiles(id) ON DELETE CASCADE,
  target_profile_id UUID NOT NULL REFERENCES public.roommate_profiles(id) ON DELETE CASCADE,
  target_name TEXT NOT NULL,
  payment_reference TEXT UNIQUE,
  state TEXT NOT NULL DEFAULT 'awaiting_requester_decision'
    CHECK (state IN (
      'awaiting_requester_decision',
      'awaiting_payment',
      'pending_target_approval',
      'connected',
      'declined',
      'declined_by_requester'
    )),
  status TEXT NOT NULL DEFAULT 'initiated'
    CHECK (status IN (
      'initiated',
      'pending_target_approval',
      'connected',
      'declined',
      'declined_by_requester'
    )),
  credits_deducted BOOLEAN NOT NULL DEFAULT FALSE,
  credit_refunded BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  connected_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  CONSTRAINT co_renting_request_distinct_profiles
    CHECK (requester_profile_id <> target_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_co_renting_requests_requester
  ON public.co_renting_connection_requests (requester_user_id, state);
CREATE INDEX IF NOT EXISTS idx_co_renting_requests_target
  ON public.co_renting_connection_requests (target_profile_id);
CREATE INDEX IF NOT EXISTS idx_co_renting_requests_reference
  ON public.co_renting_connection_requests (payment_reference);

ALTER TABLE public.co_renting_match_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.co_renting_connection_requests ENABLE ROW LEVEL SECURITY;
