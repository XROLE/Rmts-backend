-- Monthly apartment requests now support multiple preferred areas, matching
-- the roommate profile design (preferred_locations TEXT[]). Migrate the
-- existing singular column to an array and rebuild the supporting index.
ALTER TABLE public.monthly_apartment_requests
    ADD COLUMN preferred_locations text[] NOT NULL DEFAULT '{}';

UPDATE public.monthly_apartment_requests
SET preferred_locations = ARRAY[preferred_location]
WHERE preferred_location IS NOT NULL AND preferred_location <> '';

ALTER TABLE public.monthly_apartment_requests
    DROP COLUMN preferred_location;

DROP INDEX IF EXISTS public.idx_monthly_apartment_requests_state_location;

CREATE INDEX idx_monthly_apartment_requests_locations
    ON public.monthly_apartment_requests USING GIN (preferred_locations);

CREATE INDEX idx_monthly_apartment_requests_state
    ON public.monthly_apartment_requests (state);
