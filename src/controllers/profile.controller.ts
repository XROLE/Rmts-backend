import { Request, Response } from 'express';
import { profileService } from '../services/profile.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Handles the public registration + profile creation flow.
 */
export const createProfile = asyncHandler(
  async (req: Request, res: Response) => {
    const ref =
      typeof req.query.ref === 'string' && req.query.ref.trim()
        ? req.query.ref.trim()
        : undefined;
    const profile = await profileService.create(req.body, ref);
    res.status(201).json({
      success: true,
      message: 'Profile created successfully',
      data: profile,
    });
  },
);