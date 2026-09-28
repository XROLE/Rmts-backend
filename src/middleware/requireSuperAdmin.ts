import { NextFunction, Response } from 'express';
import { HttpError } from './errorHandler.js';
import type { AuthenticatedRequest } from './auth.js';
import { getUserRole } from '../utils/role.js';

/**
 * Restricts a route to users whose role is 'super_admin'. Must run after
 * requireAuth so req.user is populated. Rejects everyone else with 403.
 */
export async function requireSuperAdmin(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user?.id) {
      throw new HttpError(401, 'Authentication required');
    }

    const role = await getUserRole(req.user.id);

    if (role === null) {
      throw new HttpError(404, 'User record not found');
    }

    if (role !== 'super_admin') {
      throw new HttpError(403, 'Forbidden: super admin access required');
    }

    return next();
  } catch (err) {
    return next(err);
  }
}