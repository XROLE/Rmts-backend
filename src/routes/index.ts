import { Router } from 'express';
import authRoutes from './auth.routes.js';
import profileRoutes from './profile.routes.js';
import ambassadorRoutes from './ambassador.routes.js';
import verificationRoutes from './verification.routes.js';
import supportRoutes from './support.routes.js';
import paymentRoutes from './payment.routes.js';
import matchRoutes from './match.routes.js';
import whatsappRoutes from './whatsapp.routes.js';
import jobRoutes from './job.routes.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.status(200).json({ success: true, status: 'ok' });
});

router.use('/auth', authRoutes);
router.use('/profiles', profileRoutes);
router.use('/ambassadors', ambassadorRoutes);
router.use('/verification', verificationRoutes);
router.use('/support', supportRoutes);
router.use('/payments', paymentRoutes);
router.use('/matches', matchRoutes);
router.use('/whatsapp', whatsappRoutes);
router.use('/jobs', jobRoutes);

export default router;
