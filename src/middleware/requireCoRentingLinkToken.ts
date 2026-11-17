import { NextFunction, Request, Response } from 'express';
import { verifyCoRentingLinkToken } from '../services/coRentingLinkToken.service.js';
import { HttpError } from './errorHandler.js';

export interface CoRentingRequest extends Request {
  coRenting?: {
    profileId: string;
  };
}

/**
 * Verifies the signed token attached by Sido to the co-renting form link and
 * exposes the roommate profile id it was issued for. Used instead of a bearer
 * token on the interest endpoint, since the form is submitted by users who are
 * not logged into the website.
 */
export async function requireCoRentingLinkToken(
  req: CoRentingRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const raw = req.query.token;
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new HttpError(401, 'A co-renting link token is required');
    }

    const { profileId } = verifyCoRentingLinkToken(raw.trim());
    req.coRenting = { profileId };

    return next();
  } catch (err) {
    return next(err);
  }
}
