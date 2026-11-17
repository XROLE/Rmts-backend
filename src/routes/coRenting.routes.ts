import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCoRentingLinkToken } from '../middleware/requireCoRentingLinkToken.js';
import { requireRegisteredUser } from '../middleware/requireRegisteredUser.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import {
  getCoRentersSchema,
  setCoRentingInterestSchema,
  updateCoRentingStatusSchema,
} from '../schemas/coRenting.schema.js';
import {
  getCoRenters,
  setCoRentingInterest,
  updateCoRentingStatus,
} from '../controllers/coRenting.controller.js';

const router = Router();

// Public form submitted from the Sido link: the signed token identifies the
// roommate profile to update (no website login required).
router.patch(
  '/interest',
  requireCoRentingLinkToken,
  validate(setCoRentingInterestSchema),
  setCoRentingInterest,
);

// Any registered user: browse the paginated co-renters directory.
router.get(
  '/renters',
  requireAuth,
  requireRegisteredUser,
  validate(getCoRentersSchema),
  getCoRenters,
);

// Admin-only: transition a co-renter's matching status.
router.patch(
  '/:id/matching-status',
  requireAuth,
  requireAdmin,
  validate(updateCoRentingStatusSchema),
  updateCoRentingStatus,
);

export default router;
