import { NextFunction, Response } from 'express';
import { createAnonClient, supabase } from '../config/supabase.js';
import { verifyCoRentingLinkToken } from '../services/coRentingLinkToken.service.js';
import { HttpError } from './errorHandler.js';
import type { AuthenticatedRequest } from './auth.js';
import type { CoRentingRequest } from './requireCoRentingLinkToken.js';

export type CoRenterAccessRequest = CoRentingRequest & AuthenticatedRequest;

/**
 * Guards the co-renters directory. Accepts either the signed token Sido
 * attaches to the /co-renters link, or a normal Supabase Bearer token whose
 * user exists in public.users. The token path needs no database lookup — the
 * signature already identifies a roommate profile.
 */
export async function requireCoRenterAccess(
  req: CoRenterAccessRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rawToken = req.query.token;
    if (typeof rawToken === 'string' && rawToken.trim()) {
      const { profileId } = verifyCoRentingLinkToken(rawToken.trim());
      req.coRenting = { profileId };
      return next();
    }

    const header = req.headers.authorization ?? '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!bearer) {
      throw new HttpError(401, 'A co-renting link token or Bearer token is required');
    }

    const anon = createAnonClient();
    const { data: authData, error: authError } = await anon.auth.getUser(bearer);
    if (authError || !authData.user) {
      throw new HttpError(401, 'Invalid or expired token');
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (userError) {
      throw new HttpError(500, `Failed to verify user: ${userError.message}`);
    }
    if (!user) {
      throw new HttpError(404, 'User record not found');
    }

    req.user = { id: authData.user.id, email: authData.user.email ?? undefined };
    return next();
  } catch (err) {
    return next(err);
  }
}
