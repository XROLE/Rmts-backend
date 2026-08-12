import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import {
  changeAmbassadorPasswordSchema,
  loginAmbassadorSchema,
  refreshAmbassadorTokenSchema,
  registerAmbassadorSchema,
  updateAmbassadorProfileSchema,
} from '../schemas/ambassador.schema.js';
import {
  changeAmbassadorPassword,
  getAmbassadorProfile,
  loginAmbassador,
  refreshAmbassadorToken,
  registerAmbassador,
  updateAmbassadorProfile,
} from '../controllers/ambassador.controller.js';

const router = Router();

router.post(
  '/register',
  validate(registerAmbassadorSchema),
  registerAmbassador,
);

router.post('/login', validate(loginAmbassadorSchema), loginAmbassador);

// Public: exchange a refresh token for a fresh access token.
router.post(
  '/refresh',
  validate(refreshAmbassadorTokenSchema),
  refreshAmbassadorToken,
);

// Authenticated routes — require a valid Supabase access token.
router.use(requireAuth);

router.get('/me', getAmbassadorProfile);
router.patch(
  '/me',
  validate(updateAmbassadorProfileSchema),
  updateAmbassadorProfile,
);
router.post(
  '/me/password',
  validate(changeAmbassadorPasswordSchema),
  changeAmbassadorPassword,
);

export default router;