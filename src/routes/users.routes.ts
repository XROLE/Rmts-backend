import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireSuperAdmin } from '../middleware/requireSuperAdmin.js';
import { deleteUserSchema } from '../schemas/user.schema.js';
import { deleteUser } from '../controllers/user.controller.js';

const router = Router();

// Super-admin-only: soft-delete (deactivate) a user by id.
router.delete(
  '/:id',
  requireAuth,
  requireSuperAdmin,
  validate(deleteUserSchema),
  deleteUser,
);

export default router;
