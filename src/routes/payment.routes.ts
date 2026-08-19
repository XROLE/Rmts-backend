import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import {
  createPaymentLinkSchema,
  getTransactionsSchema,
  requestWithdrawalSchema,
} from '../schemas/payment.schema.js';
import {
  createPaymentLink,
  getPaymentSummary,
  getPaymentTransactions,
  getPaystackBalance,
  paystackWebhook,
  requestWithdrawal,
} from '../controllers/payment.controller.js';

const router = Router();

// Public: Paystack callback for payment/transfer events. Consumed with a raw
// body so the HMAC signature can be verified against the exact payload.
router.post('/webhook', paystackWebhook);

// Authenticated routes.
router.use(requireAuth);

// Admin only: current Paystack wallet balance (funds ambassador payouts).
router.get('/balance', requireAdmin, getPaystackBalance);

router.post('/', validate(createPaymentLinkSchema), createPaymentLink);
router.get('/summary', getPaymentSummary);
router.get('/transactions', validate(getTransactionsSchema), getPaymentTransactions);
router.post('/withdrawals', validate(requestWithdrawalSchema), requestWithdrawal);

export default router;
