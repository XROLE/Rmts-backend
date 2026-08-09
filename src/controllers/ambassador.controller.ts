import { Request, Response } from 'express';
import { ambassadorService } from '../services/ambassador.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

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