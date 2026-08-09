import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import WS from 'ws';
import type { WebSocketLikeConstructor } from '@supabase/realtime-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    'Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment.',
  );
}

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  realtime: {
    transport: WS as unknown as WebSocketLikeConstructor,
  },
} as const;

/**
 * Server-side Supabase client using the service role key.
 * Bypasses RLS for administrative operations. Never use this client for
 * user sign-in: calling signInWithPassword mutates its auth state and
 * downgrades subsequent calls to the 'authenticated' role.
 */
export const supabase: SupabaseClient = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  clientOptions,
);

/**
 * Creates an isolated, ephemeral Supabase client built on the anon key.
 * This is the ONLY client used for retrieving user sessions via
 * signInWithPassword, keeping the service-role client's auth state clean.
 */
export function createAnonClient(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing Supabase configuration. Set SUPABASE_ANON_KEY to issue user sessions.',
    );
  }
  return createClient(supabaseUrl, supabaseAnonKey, clientOptions);
}