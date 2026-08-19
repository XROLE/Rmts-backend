import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { getMatchesSchema, createMatchSchema } from '../schemas/match.schema.js';
import { getMatches, createMatch } from '../controllers/match.controller.js';

const router = Router();

// Admin-only: paginated list of roommate matches (all pairs, sorted by score).
router.get(
  '/',
  requireAuth,
  requireAdmin,
  validate(getMatchesSchema),
  getMatches,
);

// Admin-only: confirm and persist a match between two roommate profiles.
router.post(
  '/',
  requireAuth,
  requireAdmin,
  validate(createMatchSchema),
  createMatch,
);

export default router;
