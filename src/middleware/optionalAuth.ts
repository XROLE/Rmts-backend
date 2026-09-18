import { NextFunction, Response } from 'express';
import { createAnonClient } from '../config/supabase.js';
import type { AuthenticatedRequest } from './auth.js';

/**
 * Mirrors requireAuth but never fails: attaches the user only when a
 * valid bearer token is supplied. Use for endpoints that must stay
 * public but can enrich requests with a user identity when available.
 */
export async function optionalAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    if (token) {
      const anon = createAnonClient();
      const { data, error } = await anon.auth.getUser(token);
      if (!error && data.user) {
        req.user = {
          id: data.user.id,
          email: data.user.email ?? undefined,
        };
      }
    }

    return next();
  } catch {
    return next();
  }
}