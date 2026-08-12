import { NextFunction, Request, Response } from 'express';
import { createAnonClient } from '../config/supabase.js';
import { HttpError } from './errorHandler.js';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
  };
}

/**
 * Verifies the Supabase access token from the Authorization header and
 * attaches the authenticated user to req.user. Uses an isolated anon-key
 * client so the service-role client's auth state is never downgraded.
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : header;

    if (!token) {
      throw new HttpError(401, 'Authorization token is required');
    }

    const anon = createAnonClient();
    const { data, error } = await anon.auth.getUser(token);

    if (error || !data.user) {
      throw new HttpError(401, 'Invalid or expired token');
    }

    req.user = {
      id: data.user.id,
      email: data.user.email ?? undefined,
    };

    return next();
  } catch (err) {
    return next(err);
  }
}