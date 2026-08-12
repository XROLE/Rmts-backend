import { Request, Response } from 'express';
import { ambassadorService } from '../services/ambassador.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

export const registerAmbassador = asyncHandler(
  async (req: Request, res: Response) => {
    const { session, user, ambassadorProfile } = await ambassadorService.register(req.body);
    res.status(201).json({
      success: true,
      message: 'Ambassador account created successfully',
      data: { session, user, ambassadorProfile },
    });
  },
);

export const loginAmbassador = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await ambassadorService.login(req.body);
    res.status(200).json({
      success: true,
      message: 'Login successful',
      data,
    });
  },
);

export const getAmbassadorProfile = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const profile = await ambassadorService.getProfile(req.user!.id);
    res.status(200).json({
      success: true,
      message: 'Profile retrieved successfully',
      data: profile,
    });
  },
);

export const updateAmbassadorProfile = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const profile = await ambassadorService.updateProfile(req.user!.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: profile,
    });
  },
);

export const changeAmbassadorPassword = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const result = await ambassadorService.changePassword(
      req.user!.id,
      req.user!.email ?? '',
      req.body,
    );
    res.status(200).json({
      success: true,
      message: 'Password changed successfully',
      data: result,
    });
  },
);

export const refreshAmbassadorToken = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await ambassadorService.refreshSession(req.body);
    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      data,
    });
  },
);