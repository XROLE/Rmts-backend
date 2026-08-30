import { Response } from 'express';
import { matchService } from '../services/match.service.js';
import { whatsappLifecycleService } from '../services/whatsappLifecycle.service.js';
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

    // Send the match template to both roommates and record their
    // confirmation state. Fire-and-forget so a WhatsApp failure never
    // fails the already-persisted match.
    void whatsappLifecycleService
      .startMatchConfirmation({
        matchId: result.match.id,
        profiles: [result.profiles[0], result.profiles[1]],
      })
      .catch((err) => console.error('[match] start confirmation failed:', err));

    res.status(201).json({
      success: true,
      message: 'Match confirmed successfully',
      data: result,
    });
  },
);
