import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createSupportTicketSchema } from '../schemas/support.schema.js';
import { createSupportTicket } from '../controllers/support.controller.js';

const router = Router();

// Authenticated — users submit their own support tickets.
router.use(requireAuth);

router.post(
  '/',
  validate(createSupportTicketSchema),
  createSupportTicket,
);

export default router;
