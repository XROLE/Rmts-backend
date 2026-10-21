import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import {
  createMonthlyRequestSchema,
  notifyMonthlyRequestSchema,
} from '../schemas/monthlyRequest.schema.js';
import {
  createMonthlyRequest,
  notifyMonthlyRequests,
} from '../controllers/monthlyRequest.controller.js';

const router = Router();

// Public: submit a request for a monthly shared/paid apartment.
router.post('/', validate(createMonthlyRequestSchema), createMonthlyRequest);

// Admin: notify matching requests that space is now available.
router.post(
  '/notify',
  requireAuth,
  requireAdmin,
  validate(notifyMonthlyRequestSchema),
  notifyMonthlyRequests,
);

export default router;
