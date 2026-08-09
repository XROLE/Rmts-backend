import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import {
  loginAmbassadorSchema,
  registerAmbassadorSchema,
} from '../schemas/ambassador.schema.js';
import {
  loginAmbassador,
  registerAmbassador,
} from '../controllers/ambassador.controller.js';

const router = Router();

router.post(
  '/register',
  validate(registerAmbassadorSchema),
  registerAmbassador,
);

router.post('/login', validate(loginAmbassadorSchema), loginAmbassador);

export default router;