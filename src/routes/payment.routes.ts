import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import {
  createPaymentLinkSchema,
  getTransactionsSchema,
  confirmWithdrawalSchema,
  requestWithdrawalSchema,
} from '../schemas/payment.schema.js';
import {
  createPaymentLink,
  getPaymentSummary,
  getPaymentTransactions,
  getPaystackBalance,
  paystackWebhook,
  requestWithdrawal,
  confirmWithdrawal,
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

// Admin only: approve (fires the Paystack transfer) or reject a pending
// ambassador withdrawal.
router.patch(
  '/withdrawals/:id/confirm',
  requireAdmin,
  validate(confirmWithdrawalSchema),
  confirmWithdrawal,
);

export default router;
