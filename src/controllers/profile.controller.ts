import { Request, Response } from 'express';
import { profileService } from '../services/profile.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

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

export const getProfileStats = asyncHandler(
  async (_req: AuthenticatedRequest, res: Response) => {
    const data = await profileService.getDashboardStats();
    res.status(200).json({
      success: true,
      message: 'Profile stats retrieved successfully',
      data,
    });
  },
);

export const getAllUsers = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);
    const { items, total } = await profileService.listAll(limit, offset);
    res.status(200).json({
      success: true,
      message: 'Users retrieved successfully',
      data: {
        items,
        pagination: { total, limit, offset },
      },
    });
  },
);