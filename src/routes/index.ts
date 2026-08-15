import { Router } from 'express';
import profileRoutes from './profile.routes.js';
import ambassadorRoutes from './ambassador.routes.js';
import verificationRoutes from './verification.routes.js';
import supportRoutes from './support.routes.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.status(200).json({ success: true, status: 'ok' });
});

router.use('/profiles', profileRoutes);
router.use('/ambassadors', ambassadorRoutes);
router.use('/verification', verificationRoutes);
router.use('/support', supportRoutes);

export default router;