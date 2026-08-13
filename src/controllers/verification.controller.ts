import type { Response } from 'express';
import { verificationService } from '../services/verification.service.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const initiateVerification = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const data = await verificationService.initiate(req.user!.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Verification code sent. Use POST /verification/confirm to complete.',
      data,
    });
  },
);

export const confirmVerification = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const data = await verificationService.confirm(req.user!.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Contact verified successfully',
      data,
    });
  },
);