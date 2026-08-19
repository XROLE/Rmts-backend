import { Request, Response } from 'express';
import { paymentService } from '../services/payment.service.js';
import { paystackService } from '../services/paystack.service.js';
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
    console.log('[webhook] received', {
      hasSignature: Boolean(signature),
      bodyBytes: rawBody.length,
    });
    try {
      const result = await paymentService.handleWebhookEvent(rawBody, signature);
      console.log('[webhook] outcome', result);
      res.status(200).json({ success: true, ...result });
    } catch (err) {
      console.error('[webhook] failed', err);
      throw err;
    }
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

export const getAllPaymentRequests = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);
    const status = req.query.status as 'pending' | 'paid' | 'failed' | undefined;
    const { items, total } = await paymentService.listPaymentRequests(
      limit,
      offset,
      status,
    );
    res.status(200).json({
      success: true,
      message: 'Payment requests retrieved successfully',
      data: {
        items,
        pagination: { total, limit, offset },
      },
    });
  },
);

export const getPaystackBalance = asyncHandler(
  async (_req: AuthenticatedRequest, res: Response) => {
    const data = await paystackService.getBalance();
    res.status(200).json({
      success: true,
      message: 'Paystack balance retrieved successfully',
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

export const confirmWithdrawal = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const data = await paymentService.confirmWithdrawal(
      req.params.id,
      req.body,
    );
    res.status(200).json({
      success: true,
      message:
        data.status === 'pending'
          ? 'Withdrawal is still processing at Paystack'
          : `Withdrawal ${data.status === 'paid' ? 'approved' : 'failed'} successfully`,
      data,
    });
  },
);
