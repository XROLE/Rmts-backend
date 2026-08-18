import { NextFunction, Response } from 'express';
import { supabase } from '../config/supabase.js';
import { HttpError } from './errorHandler.js';
import type { AuthenticatedRequest } from './auth.js';

/**
 * Restricts a route to users whose role is 'admin'. Must run after requireAuth
 * so req.user is populated. Rejects non-admins with 403.
 */
export async function requireAdmin(
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
      .select('role')
      .eq('id', req.user.id)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Failed to verify admin role: ${error.message}`);
    }

    if (!data) {
      throw new HttpError(404, 'User record not found');
    }

    if (data.role !== 'admin') {
      throw new HttpError(403, 'Forbidden: admin access required');
    }

    return next();
  } catch (err) {
    return next(err);
  }
}
