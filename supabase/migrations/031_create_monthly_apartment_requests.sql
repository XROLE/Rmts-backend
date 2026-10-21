-- Minimal requests for monthly shared (paid) apartments.
-- No matching/payment machinery — these requests are simply stored and
-- notified when a suitable space becomes available in the user's area.
CREATE TYPE monthly_request_gender AS ENUM ('male', 'female', 'no_preference');

CREATE TABLE public.monthly_apartment_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    phone_number text NOT NULL,
    email text,
    gender monthly_request_gender NOT NULL,
    state varchar(100) NOT NULL,
    preferred_location text NOT NULL,
    budget numeric NOT NULL CHECK (budget >= 0),
    move_in_date date NOT NULL,
    confirmed_at timestamptz,
    notified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_monthly_apartment_requests_state_location
    ON public.monthly_apartment_requests (state, preferred_location);

-- Public insert is driven by the web request form; admin notify reads rows.
ALTER TABLE public.monthly_apartment_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "monthly_apartment_requests_public_insert"
    ON public.monthly_apartment_requests
    FOR INSERT
    WITH CHECK (true);

CREATE POLICY "monthly_apartment_requests_admin_select"
    ON public.monthly_apartment_requests
    FOR SELECT
    USING (auth.role() = 'service_role');
