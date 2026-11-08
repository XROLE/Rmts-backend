import { Request, Response } from 'express';
import { fairnestService } from '../services/fairnest.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

export const createRent = asyncHandler(
  async (req: Request, res: Response) => {
    const ref =
      typeof req.query.ref === 'string' && req.query.ref.trim()
        ? req.query.ref.trim()
        : undefined;
    const request = await fairnestService.createRent(req.body, ref);

    res.status(201).json({
      success: true,
      message: 'FairNest rent request created successfully',
      data: request,
    });
  },
);

export const createBuy = asyncHandler(
  async (req: Request, res: Response) => {
    const ref =
      typeof req.query.ref === 'string' && req.query.ref.trim()
        ? req.query.ref.trim()
        : undefined;
    const request = await fairnestService.createBuy(req.body, ref);

    res.status(201).json({
      success: true,
      message: 'FairNest buy request created successfully',
      data: request,
    });
  },
);

export const listRent = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);
    const { items, total } = await fairnestService.listRent(limit, offset);
    res.status(200).json({
      success: true,
      message: 'FairNest rent requests retrieved successfully',
      data: {
        items,
        pagination: { total, limit, offset },
      },
    });
  },
);

export const listBuy = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);
    const { items, total } = await fairnestService.listBuy(limit, offset);
    res.status(200).json({
      success: true,
      message: 'FairNest buy requests retrieved successfully',
      data: {
        items,
        pagination: { total, limit, offset },
      },
    });
  },
);
