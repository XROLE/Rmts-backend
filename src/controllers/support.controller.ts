import type { Response } from 'express';
import { supportService } from '../services/support.service.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const createSupportTicket = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const data = await supportService.create(
      req.user!.id,
      req.user!.email,
      req.body,
    );
    res.status(201).json({
      success: true,
      message: 'Support ticket submitted successfully',
      data,
    });
  },
);
