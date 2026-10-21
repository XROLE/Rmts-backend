import { Request, Response } from 'express';
import { monthlyRequestService } from '../services/monthlyRequest.service.js';
import type {
  CreateMonthlyRequestInput,
  NotifyMonthlyRequestInput,
} from '../schemas/monthlyRequest.schema.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

/**
 * Public submission of a monthly shared-apartment request. Sido confirms the
 * request over WhatsApp (fire-and-forget inside the service).
 */
export const createMonthlyRequest = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await monthlyRequestService.create(
      req.body as CreateMonthlyRequestInput,
    );

    res.status(201).json({
      success: true,
      message: 'Monthly apartment request created successfully',
      data,
    });
  },
);

/**
 * Admin action: notify everyone who requested a monthly shared space in the
 * given state + area that a space is now available.
 */
export const notifyMonthlyRequests = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { state, preferredLocation } =
      req.body as NotifyMonthlyRequestInput;

    const result = await monthlyRequestService.notifyByArea(
      state,
      preferredLocation,
    );

    res.status(200).json({
      success: true,
      message: `Notified ${result.notified} of ${result.total} matching requests`,
      data: result,
    });
  },
);
