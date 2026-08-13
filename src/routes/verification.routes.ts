import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  confirmVerificationSchema,
  initiateVerificationSchema,
} from '../schemas/verification.schema.js';
import {
  confirmVerification,
  initiateVerification,
} from '../controllers/verification.controller.js';

const router = Router();

// Authenticated — verify the caller's own contact.
router.use(requireAuth);

router.post(
  '/initiate',
  validate(initiateVerificationSchema),
  initiateVerification,
);
router.post(
  '/confirm',
  validate(confirmVerificationSchema),
  confirmVerification,
);

export default router;