import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import routes from './routes/index.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

/** Express handler that keeps the raw request body for HMAC verification. */
function rawJson(req: express.Request, res: express.Response, next: express.NextFunction) {
  res.locals.rawBody = (req.body as Buffer).toString('utf8');
  next();
}

export function createApp(): Application {
  const app: Application = express();

  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN?.split(',') ?? '*',
      credentials: true,
    }),
  );

  // Preserve the raw body for the WhatsApp webhook so the HMAC signature can
  // be verified against the exact bytes Meta signed.
  app.use('/api/v1/whatsapp/webhook', express.raw({ type: 'application/json', limit: '1mb' }), rawJson);

  // Preserve the raw body for the Paystack webhook so the HMAC signature can
  // be verified against the exact bytes Paystack signed.
  app.use('/api/v1/payments/webhook', express.raw({ type: 'application/json', limit: '1mb' }), rawJson);

  // Same raw-body preservation for the roommate unlock payment webhook.
  app.use('/api/v1/payments/paystack-webhook', express.raw({ type: 'application/json', limit: '1mb' }), rawJson);

  app.use(express.json({ limit: '1mb' }));

  app.use('/api/v1', routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}