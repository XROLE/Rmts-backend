import { NextFunction, Request, Response } from 'express';
import { createAnonClient } from '../config/supabase.js';
import { HttpError } from './errorHandler.js';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
  };
}

function decodeExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof json?.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
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

    if (!header || !header.startsWith('Bearer ')) {
      throw new HttpError(
        401,
        'Malformed Authorization header. Expected: "Bearer <accessToken>"',
      );
    }

    const token = header.slice(7).trim();
    if (!token) {
      throw new HttpError(
        401,
        'Malformed Authorization header. Expected: "Bearer <accessToken>"',
      );
    }

    console.log('[auth] token =', JSON.stringify(token));

    const anon = createAnonClient();
    const { data, error } = await anon.auth.getUser(token);

    if (error || !data.user) {
      console.log('Supabase auth error:', {
        message: error?.message,
        name: error?.name,
        status: error?.status,
        tokenProvided: true,
      });

      const exp = decodeExpiry(token);
      if (exp !== null && exp * 1000 <= Date.now()) {
        throw new HttpError(
          401,
          'Access token expired. Refresh it via POST /api/v1/ambassadors/refresh',
        );
      }

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