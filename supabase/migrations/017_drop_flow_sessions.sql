-- ============================================================
-- 017_drop_flow_sessions.sql
-- Reverse of 016: the Data Exchange endpoint was removed in favour
-- of link-driven registration (flow submissions return via the
-- webhook nfm_reply, keeping the sender phone). flow_sessions is
-- no longer written or read, so drop it (cascades its indexes,
-- RLS policies and triggers).
-- ============================================================

DROP TABLE IF EXISTS public.flow_sessions;