import { Request, Response } from 'express';
import { paymentService } from '../services/payment.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

export const createPaymentLink = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const result = await paymentService.createPaymentLink(req.user!.id, req.body);
    res.status(201).json({
      success: true,
      message: 'Payment link created successfully',
      data: result,
    });
  },
);

export const paystackWebhook = asyncHandler(
  async (req: Request, res: Response) => {
    const rawBody = (res.locals.rawBody as string | undefined) ?? '';
    const signature = req.headers['x-paystack-signature'] as string | undefined;
    const result = await paymentService.handleWebhookEvent(rawBody, signature);
    res.status(200).json({ success: true, ...result });
  },
);

export const getPaymentSummary = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const data = await paymentService.getSummary(req.user!.id);
    res.status(200).json({
      success: true,
      message: 'Payment summary retrieved successfully',
      data,
    });
  },
);

export const getPaymentTransactions = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const data = await paymentService.getTransactions(req.user!.id, {
      type: req.query.type as 'paid' | 'pending' | 'withdrawal' | undefined,
      limit: Number(req.query.limit ?? 20),
      offset: Number(req.query.offset ?? 0),
    });
    res.status(200).json({
      success: true,
      message: 'Transactions retrieved successfully',
      data,
    });
  },
);

export const requestWithdrawal = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const data = await paymentService.requestWithdrawal(req.user!.id, req.body);
    res.status(201).json({
      success: true,
      message: 'Withdrawal request submitted successfully',
      data,
    });
  },
);
