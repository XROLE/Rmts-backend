import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import {
  createProfileSchema,
  getAllUsersSchema,
  getProfileByLookupSchema,
  searchProfilesSchema,
  updateProfileSchema,
  updateProfileStatusSchema,
} from '../schemas/profile.schema.js';
import {
  createProfile,
  getAllUsers,
  getProfileByLookup,
  getProfileStats,
  searchProfiles,
  updateProfileByPhone,
  updateProfileStatus,
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

// Admin-only: set a roommate request to paused or suspended. Pausing/suspending
// stops matching and notifies the user via a Sido WhatsApp template.
router.patch(
  '/:id/status',
  requireAuth,
  requireAdmin,
  validate(updateProfileStatusSchema),
  updateProfileStatus,
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

// Admin-only: filtered search over roommate profiles (state required).
router.get(
  '/search',
  requireAuth,
  requireAdmin,
  validate(searchProfilesSchema),
  searchProfiles,
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