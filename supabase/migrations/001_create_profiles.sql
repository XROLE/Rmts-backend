CREATE TYPE gender_enum AS ENUM ('male', 'female', 'no_preference');
CREATE TYPE marital_status_enum AS ENUM ('single', 'married', 'divorced', 'prefer_not_to_say');
CREATE TYPE smoking_habit_enum AS ENUM ('non_smoker', 'occasional_smoker', 'regular_smoker');
CREATE TYPE occupation_status_enum AS ENUM ('student', 'nysc', 'working_professional', 'self_employed', 'job_seeker');
CREATE TYPE profile_status_enum AS ENUM ('new', 'reviewing', 'potential_match_found', 'waiting_approval', 'payment_pending', 'paid', 'connected', 'closed', 'paused');

CREATE TABLE public.roommate_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Private Contact & Personal Info
    full_name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    email VARCHAR(150), -- Optional
    gender gender_enum NOT NULL,
    age_range VARCHAR(20) NOT NULL,
    marital_status marital_status_enum NOT NULL DEFAULT 'single',
    religion VARCHAR(50),

    -- Preferences
    preferred_locations TEXT[] NOT NULL,
    budget_min NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    budget_max NUMERIC(12, 2) NOT NULL,
    expected_move_in_date DATE NOT NULL,

    -- Lifestyle Data
    occupation occupation_status_enum NOT NULL,
    smoking_habit smoking_habit_enum NOT NULL DEFAULT 'non_smoker',
    allows_pets BOOLEAN DEFAULT FALSE,
    sleep_habit VARCHAR(50),
    personal_bio TEXT,

    -- Legal & Platform Metrics
    agreed_to_terms BOOLEAN NOT NULL DEFAULT FALSE CHECK (agreed_to_terms = TRUE),
    agreed_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    referred_by_code VARCHAR(30),
    status profile_status_enum DEFAULT 'new',
    is_active BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX idx_profiles_preferred_locations ON public.roommate_profiles USING GIN (preferred_locations);
CREATE INDEX idx_profiles_budget ON public.roommate_profiles (budget_min, budget_max);
CREATE INDEX idx_profiles_status ON public.roommate_profiles (status);
CREATE INDEX idx_profiles_referral ON public.roommate_profiles (referred_by_code);