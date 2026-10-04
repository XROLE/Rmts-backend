import { NextFunction, Response } from 'express';
import { HttpError } from './errorHandler.js';
import type { AuthenticatedRequest } from './auth.js';
import { getUserRole } from '../utils/role.js';

/**
 * Restricts a route to users whose role is 'admin' or 'super_admin' (super
 * admins inherit all admin privileges). Must run after requireAuth so req.user
 * is populated. Rejects everyone else with 403.
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

    const role = await getUserRole(req.user.id);

    if (role === null) {
      throw new HttpError(404, 'User record not found');
    }

    if (role !== 'admin' && role !== 'super_admin') {
      throw new HttpError(403, 'Forbidden: admin access required');
    }

    return next();
  } catch (err) {
    return next(err);
  }
}