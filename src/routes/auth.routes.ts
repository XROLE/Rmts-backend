import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { refreshTokenSchema } from '../schemas/auth.schema.js';
import { refreshToken } from '../controllers/auth.controller.js';

const router = Router();

// Public: exchange a refresh token for a fresh access token for any
// authenticated user (ambassador, admin, or super admin).
router.post('/refresh', validate(refreshTokenSchema), refreshToken);

export default router;