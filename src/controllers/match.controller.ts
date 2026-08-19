import { Response } from 'express';
import { matchService } from '../services/match.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

export const getMatches = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);
    const { pairs, total } = await matchService.listMatches(limit, offset);
    res.status(200).json({
      success: true,
      message: 'Matches retrieved successfully',
      data: {
        items: pairs,
        pagination: { total, limit, offset },
      },
    });
  },
);

export const createMatch = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { roommateProfileAId, roommateProfileBId } = req.body;
    const result = await matchService.confirmMatch(roommateProfileAId, roommateProfileBId);
    res.status(201).json({
      success: true,
      message: 'Match confirmed successfully',
      data: result,
    });
  },
);
