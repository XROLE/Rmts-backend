import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import WS from 'ws';
import type { WebSocketLikeConstructor } from '@supabase/realtime-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    'Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment.',
  );
}

/**
 * Server-side Supabase client using the service role key.
 * Bypasses RLS for administrative operations.
 */
export const supabase: SupabaseClient = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      transport: WS as unknown as WebSocketLikeConstructor,
    },
  },
);