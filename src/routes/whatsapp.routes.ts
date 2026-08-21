import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { startHandoverSchema } from '../schemas/whatsapp.schema.js';
import {
  whatsappWebhookGet,
  whatsappWebhookPost,
  startHandover,
} from '../controllers/whatsapp.controller.js';

const router = Router();

// Public: Meta webhook verification handshake + inbound events.
router.get('/webhook', whatsappWebhookGet);
router.post('/webhook', whatsappWebhookPost);

// Authenticated routes.
router.use(requireAuth);

// Admin only: start/retry a confirmed match's WhatsApp handover.
router.post(
  '/handovers/:matchId/start',
  requireAdmin,
  validate(startHandoverSchema),
  startHandover,
);

export default router;
