import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import {
  triggerOnboardingSchema,
  triggerMatchSchema,
} from '../schemas/whatsapp.schema.js';
import {
  whatsappWebhookGet,
  whatsappWebhookPost,
  triggerOnboarding,
  triggerMatch,
} from '../controllers/whatsapp.controller.js';

const router = Router();

// Public: Meta webhook verification handshake + inbound events.
router.get('/webhook', whatsappWebhookGet);
router.post('/webhook', whatsappWebhookPost);

// Authenticated routes.
router.use(requireAuth);

// Internal triggers (admin only): send the onboarding / match decision Flows.
router.post(
  '/trigger-onboarding',
  requireAdmin,
  validate(triggerOnboardingSchema),
  triggerOnboarding,
);
router.post(
  '/trigger-match',
  requireAdmin,
  validate(triggerMatchSchema),
  triggerMatch,
);

export default router;
