import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import {
  createProfileSchema,
  getAllUsersSchema,
  getProfileByLookupSchema,
  updateProfileSchema,
} from '../schemas/profile.schema.js';
import {
  createProfile,
  getAllUsers,
  getProfileByLookup,
  getProfileStats,
  updateProfileByPhone,
} from '../controllers/profile.controller.js';

const router = Router();

// Public: profile creation (registration without auth credentials).
router.post('/', validate(createProfileSchema), createProfile);

// Sido/WhatsApp context: update a roommate request by the owner's phone number.
// Trusted only when called from the authenticated WhatsApp conversation.
router.patch(
  '/by-phone',
  validate(updateProfileSchema),
  updateProfileByPhone,
);

// Admin-only: dashboard profile lifecycle metrics.
router.get('/stats', requireAuth, requireAdmin, getProfileStats);

// Admin-only: paginated list of all roommate profiles.
router.get(
  '/',
  requireAuth,
  requireAdmin,
  validate(getAllUsersSchema),
  getAllUsers,
);

// Admin-only: look up a single roommate profile by email or phone number.
router.get(
  '/lookup',
  requireAuth,
  requireAdmin,
  validate(getProfileByLookupSchema),
  getProfileByLookup,
);

export default router;