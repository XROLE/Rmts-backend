import { Router } from 'express';
import multer from 'multer';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import {
  changeAmbassadorPasswordSchema,
  getAllAmbassadorsSchema,
  loginAmbassadorSchema,
  refreshAmbassadorTokenSchema,
  registerAmbassadorSchema,
  saveBankDetailsSchema,
  updateAmbassadorProfileSchema,
  verifyBankDetailsSchema,
} from '../schemas/ambassador.schema.js';
import {
  changeAmbassadorPassword,
  getAllAmbassadors,
  getAmbassadorBanks,
  getAmbassadorProfile,
  getAmbassadorReferrals,
  getAmbassadorStats,
  loginAmbassador,
  refreshAmbassadorToken,
  registerAmbassador,
  saveAmbassadorBank,
  updateAmbassadorProfile,
  uploadAmbassadorProfilePicture,
  verifyAmbassadorBank,
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

// Public: list supported Nigerian banks for the bank-selection UI.
router.get('/banks', getAmbassadorBanks);

// Authenticated routes — require a valid Supabase access token.
router.use(requireAuth);

router.get('/me', getAmbassadorProfile);
router.get('/me/referrals', getAmbassadorReferrals);

// Admin-only: dashboard ambassador metrics.
router.get('/stats', requireAdmin, getAmbassadorStats);

// Admin-only: paginated list of all ambassador profiles.
router.get(
  '/',
  requireAdmin,
  validate(getAllAmbassadorsSchema),
  getAllAmbassadors,
);
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
router.post(
  '/me/bank/verify',
  validate(verifyBankDetailsSchema),
  verifyAmbassadorBank,
);
router.post(
  '/me/bank',
  validate(saveBankDetailsSchema),
  saveAmbassadorBank,
);

export default router;