-- FairNest Housing agency: two simple lead tables (rent & buy).
-- Reuses the global gender_enum, occupation_status_enum, marital_status_enum
-- created in 001_create_profiles.sql.

CREATE TYPE fairnest_property_type AS ENUM (
  'apartment',
  'house',
  'studio',
  'duplex',
  'bungalow',
  'self_contained'
);

CREATE TABLE public.fairnest_rent_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(100) NOT NULL,
  gender gender_enum NOT NULL,
  occupation occupation_status_enum NOT NULL,
  email VARCHAR(150),
  phone_number VARCHAR(20) NOT NULL,
  marital_status marital_status_enum NOT NULL DEFAULT 'single',
  property_type fairnest_property_type NOT NULL,
  preferred_locations TEXT[] NOT NULL,
  budget_min NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  budget_max NUMERIC(12, 2) NOT NULL,
  personal_bio TEXT,
  agreed_to_terms BOOLEAN NOT NULL DEFAULT TRUE CHECK (agreed_to_terms = TRUE),
  agreed_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  referred_by_code VARCHAR(30),
  status VARCHAR(30) DEFAULT 'new',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE public.fairnest_buy_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(100) NOT NULL,
  gender gender_enum NOT NULL,
  occupation occupation_status_enum NOT NULL,
  email VARCHAR(150),
  phone_number VARCHAR(20) NOT NULL,
  marital_status marital_status_enum NOT NULL DEFAULT 'single',
  property_type fairnest_property_type NOT NULL,
  preferred_locations TEXT[] NOT NULL,
  budget_min NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  budget_max NUMERIC(12, 2) NOT NULL,
  personal_bio TEXT,
  agreed_to_terms BOOLEAN NOT NULL DEFAULT TRUE CHECK (agreed_to_terms = TRUE),
  agreed_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  referred_by_code VARCHAR(30),
  status VARCHAR(30) DEFAULT 'new',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_fairnest_rent_locations ON public.fairnest_rent_profiles USING GIN (preferred_locations);
CREATE INDEX idx_fairnest_rent_budget ON public.fairnest_rent_profiles (budget_min, budget_max);
CREATE INDEX idx_fairnest_rent_status ON public.fairnest_rent_profiles (status);

CREATE INDEX idx_fairnest_buy_locations ON public.fairnest_buy_profiles USING GIN (preferred_locations);
CREATE INDEX idx_fairnest_buy_budget ON public.fairnest_buy_profiles (budget_min, budget_max);
CREATE INDEX idx_fairnest_buy_status ON public.fairnest_buy_profiles (status);
