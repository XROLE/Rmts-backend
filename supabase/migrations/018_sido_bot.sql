-- ============================================================
-- 018_sido_bot.sql
-- Sido: the Roommates NG WhatsApp AI assistant.
--
-- Tracks one conversation session per WhatsApp phone number,
-- stores the raw back-and-forth used as LLM context (last N
-- messages), and records soft handovers where Sido asks a human
-- agent to take over the chat (the human replies directly from
-- the business number; an admin flips handed_off back to false).
-- ============================================================

-- ---------- public.sido_conversations ----------
-- One row per phone. handed_off = true silences Sido for this
-- conversation until an admin calls POST /whatsapp/bot/resume.
CREATE TABLE public.sido_conversations (
    phone TEXT PRIMARY KEY,
    handed_off BOOLEAN NOT NULL DEFAULT FALSE,
    handed_off_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    last_message_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ---------- public.sido_messages ----------
-- Chat history fed to the model (roles: user / assistant / system / tool).
-- Rows are pruned per-phone by taking only the latest N on reads.
CREATE TABLE public.sido_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL REFERENCES public.sido_conversations(phone) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX idx_sido_messages_phone_time
    ON public.sido_messages (phone, created_at);

-- ---------- public.sido_human_handovers ----------
-- Soft handover tickets. Created when Sido calls the
-- request_human_handover tool; resolved when the bot is resumed.
CREATE TABLE public.sido_human_handovers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL REFERENCES public.sido_conversations(phone) ON DELETE CASCADE,
    summary TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_sido_handovers_status_phone
    ON public.sido_human_handovers (status, phone);

-- ---------- Row Level Security ----------
-- Backend uses the service-role client (bypasses RLS). No client policies
-- are granted because these tables hold assistant transcripts, not
-- user-editable records.
ALTER TABLE public.sido_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sido_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sido_human_handovers ENABLE ROW LEVEL SECURITY;