import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import {
  createFairnestSchema,
  getAllFairnestSchema,
} from '../schemas/fairnest.schema.js';
import {
  createRent,
  createBuy,
  listRent,
  listBuy,
} from '../controllers/fairnest.controller.js';

const router = Router();

// Public: FairNest rent/buy lead creation (no auth credentials).
router.post('/rent', validate(createFairnestSchema), createRent);
router.post('/buy', validate(createFairnestSchema), createBuy);

// Admin-only: paginated listing of FairNest leads.
router.get('/rent', requireAuth, requireAdmin, validate(getAllFairnestSchema), listRent);
router.get('/buy', requireAuth, requireAdmin, validate(getAllFairnestSchema), listBuy);

export default router;
