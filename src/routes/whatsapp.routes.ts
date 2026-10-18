import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import {
  triggerOnboardingSchema,
  triggerMatchSchema,
  triggerRegistrationSchema,
  resumeBotSchema,
} from '../schemas/whatsapp.schema.js';
import {
  whatsappWebhookGet,
  whatsappWebhookPost,
  getRegistrationLink,
  triggerOnboarding,
  triggerMatch,
  triggerRegistration,
  resumeBot,
  listBotConversations,
  listSidoChats,
  getSidoChatMessages,
} from '../controllers/whatsapp.controller.js';

const router = Router();

// Public: Meta webhook verification handshake + inbound events.
router.get('/webhook', whatsappWebhookGet);
router.post('/webhook', whatsappWebhookPost);

// Public: wa.me deep link used by the website to start registration.
router.get('/registration-link', getRegistrationLink);

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
router.post(
  '/trigger-registration',
  requireAdmin,
  validate(triggerRegistrationSchema),
  triggerRegistration,
);

// Sido bot administration (admin only): answer/resume human handovers.
router.post('/bot/resume', requireAdmin, validate(resumeBotSchema), resumeBot);
router.get('/bot/conversations', requireAdmin, listBotConversations);

// Sido chat viewer (admin only): browse and read Sido <-> seeker transcripts.
router.get('/bot/chats', requireAdmin, listSidoChats);
router.get('/bot/chats/:phone/messages', requireAdmin, getSidoChatMessages);

export default router;
