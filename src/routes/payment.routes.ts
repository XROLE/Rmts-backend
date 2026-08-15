import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createPaymentLinkSchema,
  getTransactionsSchema,
  requestWithdrawalSchema,
} from '../schemas/payment.schema.js';
import {
  createPaymentLink,
  getPaymentSummary,
  getPaymentTransactions,
  paystackWebhook,
  requestWithdrawal,
} from '../controllers/payment.controller.js';

const router = Router();

// Public: Paystack callback for payment/transfer events. Consumed with a raw
// body so the HMAC signature can be verified against the exact payload.
router.post('/webhook', paystackWebhook);

// Authenticated routes.
router.use(requireAuth);

router.post('/', validate(createPaymentLinkSchema), createPaymentLink);
router.get('/summary', getPaymentSummary);
router.get('/transactions', validate(getTransactionsSchema), getPaymentTransactions);
router.post('/withdrawals', validate(requestWithdrawalSchema), requestWithdrawal);

export default router;
