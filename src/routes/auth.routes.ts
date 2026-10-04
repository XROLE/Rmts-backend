import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import {
  forgotPasswordSchema,
  refreshTokenSchema,
  resetPasswordSchema,
} from '../schemas/auth.schema.js';
import {
  forgotPassword,
  refreshToken,
  resetPassword,
} from '../controllers/auth.controller.js';

const router = Router();

// Public: exchange a refresh token for a fresh access token for any
// authenticated user (ambassador, admin, or super admin).
router.post('/refresh', validate(refreshTokenSchema), refreshToken);

// Public: forgot-password flow. POST /forgot-password issues a 4-digit code
// emailed to the address; POST /reset-password validates the code and sets
// the new password.
router.post(
  '/forgot-password',
  validate(forgotPasswordSchema),
  forgotPassword,
);
router.post('/reset-password', validate(resetPasswordSchema), resetPassword);

export default router;