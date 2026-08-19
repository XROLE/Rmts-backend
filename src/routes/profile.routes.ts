import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { createProfileSchema, getAllUsersSchema } from '../schemas/profile.schema.js';
import {
  createProfile,
  getAllUsers,
  getProfileStats,
} from '../controllers/profile.controller.js';

const router = Router();

// Public: profile creation (registration without auth credentials).
router.post('/', validate(createProfileSchema), createProfile);

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