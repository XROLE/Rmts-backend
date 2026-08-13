import { Router } from 'express';
import multer from 'multer';
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
  uploadAmbassadorProfilePicture,
} from '../controllers/ambassador.controller.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

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
router.post('/me/picture', upload.single('file'), uploadAmbassadorProfilePicture);

export default router;