import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import {
  createPaymentLinkSchema,
  getTransactionsSchema,
  confirmWithdrawalSchema,
  getAllPaymentRequestsSchema,
  rejectWithdrawalSchema,
  requestWithdrawalSchema,
} from '../schemas/payment.schema.js';
import {
  createPaymentLink,
  getPaymentSummary,
  getPaymentTransactions,
  getAllPaymentRequests,
  getPaystackBalance,
  getAdminOverview,
  paystackWebhook,
  roommatePaystackWebhook,
  requestWithdrawal,
  confirmWithdrawal,
  rejectWithdrawal,
} from '../controllers/payment.controller.js';

const router = Router();

// Public: Paystack callback for payment/transfer events. Consumed with a raw
// body so the HMAC signature can be verified against the exact payload.
router.post('/webhook', paystackWebhook);

// Public: Paystack charge.success for the roommate's one-time unlock payment.
router.post('/paystack-webhook', roommatePaystackWebhook);

// Authenticated routes.
router.use(requireAuth);

// Admin only: current Paystack wallet balance (funds ambassador payouts).
router.get('/balance', requireAdmin, getPaystackBalance);

// Admin only: dashboard finance overview (live balance + ledger aggregates).
router.get('/overview', requireAdmin, getAdminOverview);

// Admin only: paginated list of all ambassador withdrawal (payment) requests.
router.get(
  '/requests',
  requireAdmin,
  validate(getAllPaymentRequestsSchema),
  getAllPaymentRequests,
);

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

// Admin only: reject a pending ambassador withdrawal, recording the reason and
// refunding the ambassador's locked balance. No Paystack transfer is fired.
router.patch(
  '/withdrawals/:id/reject',
  requireAdmin,
  validate(rejectWithdrawalSchema),
  rejectWithdrawal,
);

export default router;
