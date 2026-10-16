import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import {
  createProfileSchema,
  getAllUsersSchema,
  updateProfileSchema,
} from '../schemas/profile.schema.js';
import {
  createProfile,
  getAllUsers,
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

export default router;