import { Request, Response } from 'express';
import { ambassadorService } from '../services/ambassador.service.js';
import { paystackService } from '../services/paystack.service.js';
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

export const getAllAmbassadors = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);
    const { items, total } = await ambassadorService.listAll(limit, offset);
    res.status(200).json({
      success: true,
      message: 'Ambassadors retrieved successfully',
      data: {
        items,
        pagination: { total, limit, offset },
      },
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

export const getAmbassadorReferrals = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const referrals = await ambassadorService.getReferrals(req.user!.id);
    res.status(200).json({
      success: true,
      message: 'Referrals retrieved successfully',
      data: { count: referrals.length, referrals },
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

export const getAmbassadorBanks = asyncHandler(
  async (_req: Request, res: Response) => {
    const banks = await paystackService.getBanks();
    res.status(200).json({
      success: true,
      message: 'Banks retrieved successfully',
      data: banks,
    });
  },
);

export const verifyAmbassadorBank = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const data = await ambassadorService.verifyBankDetails(req.user!.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Bank account verified successfully',
      data,
    });
  },
);

export const saveAmbassadorBank = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const profile = await ambassadorService.saveBankDetails(req.user!.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Bank details saved successfully',
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

export const uploadAmbassadorProfilePicture = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const file = (req as AuthenticatedRequest & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({
        success: false,
        message: 'An image file is required',
      });
      return;
    }

    const result = await ambassadorService.uploadProfilePicture(req.user!.id, {
      buffer: file.buffer,
      mimetype: file.mimetype,
      size: file.size,
      originalname: file.originalname,
    });

    res.status(200).json({
      success: true,
      message: 'Profile picture updated successfully',
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