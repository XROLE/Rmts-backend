import { Request, Response } from 'express';
import { authService } from '../services/auth.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const refreshToken = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await authService.refreshSession(req.body);
    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      data,
    });
  },
);

export const forgotPassword = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await authService.forgotPassword(req.body);
    res.status(200).json({
      success: true,
      message:
        'If an account exists for this email, a reset code has been sent.',
      data,
    });
  },
);

export const resetPassword = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await authService.resetPassword(req.body);
    res.status(200).json({
      success: true,
      message: 'Password reset successfully',
      data,
    });
  },
);