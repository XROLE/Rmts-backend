import { NextFunction, Response } from 'express';
import { supabase } from '../config/supabase.js';
import { HttpError } from './errorHandler.js';
import type { AuthenticatedRequest } from './auth.js';

/**
 * Confirms that the authenticated Supabase user also has a record in
 * public.users. Both regular users and admins pass this check; it only
 * rejects tokens for identities that are not registered in our database.
 * Must run after requireAuth so req.user is populated.
 */
export async function requireRegisteredUser(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user?.id) {
      throw new HttpError(401, 'Authentication required');
    }

    const { data, error } = await supabase
      .from('users')
      .select('id')
      .eq('id', req.user.id)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Failed to verify user: ${error.message}`);
    }

    if (!data) {
      throw new HttpError(404, 'User record not found');
    }

    return next();
  } catch (err) {
    return next(err);
  }
}
