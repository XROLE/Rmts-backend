import { supabase } from '../config/supabase.js';
import { HttpError } from '../middleware/errorHandler.js';

/** Returns the role of a user record, or null when the user does not exist. */
export async function getUserRole(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('users')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, `Failed to verify role: ${error.message}`);
  }

  return data?.role ?? null;
}