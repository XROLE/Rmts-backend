import { Router } from 'express';
import { flowExchange } from '../controllers/flowExchange.controller.js';

const router = Router();

// Public: receives WhatsApp Flows Data Exchange submissions from Meta.
router.post('/endpoint', flowExchange);

export default router;