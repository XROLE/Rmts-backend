import { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wraps an async route handler so thrown errors propagate to Express's
 * error-handling middleware instead of causing an unhandled rejection.
 */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => void): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };