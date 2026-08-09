import { Router } from 'express';
import profileRoutes from './profile.routes.js';
import ambassadorRoutes from './ambassador.routes.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.status(200).json({ success: true, status: 'ok' });
});

router.use('/profiles', profileRoutes);
router.use('/ambassadors', ambassadorRoutes);

export default router;