import { Response } from 'express';
import { coRentingService } from '../services/coRenting.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import type {
  GetCoRentersInput,
  SetCoRentingInterestInput,
  UpdateCoRentingStatusInput,
} from '../schemas/coRenting.schema.js';

/**
 * Registers (or updates) the authenticated user's co-renting interest on their
 * roommate profile. Uses req.user.id — set by requireAuth after the token is
 * verified and the user is confirmed to exist in the database.
 */
export const setCoRentingInterest = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const profile = await coRentingService.setInterest(
      req.user!.id,
      req.body as SetCoRentingInterestInput,
    );

    res.status(200).json({
      success: true,
      message: 'Co-renting interest saved successfully',
      data: profile,
    });
  },
);

/**
 * Admin-only: paginated directory of registered co-renters.
 */
export const getCoRenters = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const filters = req.query as unknown as GetCoRentersInput;
    const { items, total } = await coRentingService.listCoRenters(filters);

    res.status(200).json({
      success: true,
      message: 'Co-renters retrieved successfully',
      data: {
        items,
        pagination: { total, limit: filters.limit, offset: filters.offset },
      },
    });
  },
);

/**
 * Admin-only: transitions a co-renter between matching states.
 */
export const updateCoRentingStatus = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = (req.params as unknown as UpdateCoRentingStatusInput['params']);
    const { matchingStatus } = req.body as UpdateCoRentingStatusInput['body'];

    const profile = await coRentingService.updateMatchingStatus(id, matchingStatus);

    res.status(200).json({
      success: true,
      message: 'Co-renting matching status updated successfully',
      data: profile,
    });
  },
);
