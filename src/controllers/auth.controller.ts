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