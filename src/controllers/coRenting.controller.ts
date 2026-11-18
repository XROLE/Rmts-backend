import { Response } from 'express';
import { coRentingService } from '../services/coRenting.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import type { CoRenterAccessRequest } from '../middleware/requireCoRenterAccess.js';
import type { CoRentingRequest } from '../middleware/requireCoRentingLinkToken.js';
import type {
  GetCoRentersInput,
  SetCoRentingInterestInput,
  UpdateCoRentingStatusInput,
} from '../schemas/coRenting.schema.js';

/**
 * Registers (or updates) co-renting interest on the roommate profile identified
 * by the signed token Sido attached to the form link. No website login needed.
 */
export const setCoRentingInterest = asyncHandler(
  async (req: CoRentingRequest, res: Response) => {
    const profile = await coRentingService.setInterest(
      req.coRenting!.profileId,
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
 * Any registered user: paginated directory of registered co-renters.
 */
export const getCoRenters = asyncHandler(
  async (req: CoRenterAccessRequest, res: Response) => {
    const filters = req.query as unknown as GetCoRentersInput;
    const [renters, viewer] = await Promise.all([
      coRentingService.listCoRenters(filters),
      req.coRenting?.profileId
        ? coRentingService.getViewerProfile(req.coRenting.profileId)
        : Promise.resolve(null),
    ]);
    const { items, total } = renters;

    res.status(200).json({
      success: true,
      message: 'Co-renters retrieved successfully',
      data: {
        items,
        viewer,
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
