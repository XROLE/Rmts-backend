import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { createProfileSchema } from '../schemas/profile.schema.js';
import { createProfile } from '../controllers/profile.controller.js';

const router = Router();

// Public: profile creation (registration without auth credentials).
router.post('/', validate(createProfileSchema), createProfile);

export default router;