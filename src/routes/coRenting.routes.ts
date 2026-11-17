import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
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

// Any registered user (admin or regular): save co-renting interest on their
// own roommate profile, identified by the authenticated user id.
router.patch(
  '/interest',
  requireAuth,
  requireRegisteredUser,
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
