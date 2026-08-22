import { Request, Response } from 'express';
import { whatsappService } from '../services/whatsapp.service.js';
import { whatsappLifecycleService } from '../services/whatsappLifecycle.service.js';
import type { TriggerMatchInput } from '../services/whatsappLifecycle.service.js';

/**
 * GET /webhook — Meta's webhook verification handshake. Echoes hub.challenge
 * only when the hub.verify_token matches our configured token.
 */
export function whatsappWebhookGet(req: Request, res: Response) {
  const mode = req.query['hub.mode'];
  const verifyToken = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && verifyToken === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    res.status(200).send(challenge ?? 'ok');
    return;
  }

  res.status(403).json({ success: false, message: 'Forbidden' });
}

/**
 * POST /webhook — inbound events from Meta. Verifies the HMAC signature, then
 * dispatches Flow form submissions (nfm_reply) to the lifecycle engine:
 *   - proceed_decision -> onboarding response
 *   - accept_match     -> match decision
 */
export async function whatsappWebhookPost(req: Request, res: Response) {
  const rawBody = (res.locals.rawBody as string | undefined) ?? '';
  const signature = req.headers['x-hub-signature-256'] as string | undefined;

  if (!whatsappService.verifyWebhookSignature(rawBody, signature)) {
    res.status(401).json({ success: false, message: 'Invalid webhook signature' });
    return;
  }

  const payload = rawBody ? JSON.parse(rawBody) : {};
  const changes = payload?.entry?.[0]?.changes ?? [];

  for (const change of changes) {
    const messages = change?.value?.messages ?? [];
    for (const message of messages) {
      const nfmReply =
        message?.type === 'interactive' &&
        message?.interactive?.type === 'nfm_reply' &&
        message?.interactive?.nfm_reply?.name === 'flow'
          ? message.interactive.nfm_reply
          : null;

      if (!nfmReply || typeof nfmReply.response_json !== 'string') continue;

      let responseJson: Record<string, unknown>;
      try {
        responseJson = JSON.parse(nfmReply.response_json);
      } catch {
        console.warn('[whatsapp] unparseable nfm_reply response_json');
        continue;
      }

      try {
        if (typeof responseJson.proceed_decision === 'string') {
          await whatsappLifecycleService.handleOnboardingResponse(
            String(message.from ?? ''),
            responseJson,
          );
        } else if (
          typeof responseJson.accept_match === 'string' &&
          typeof responseJson.flow_token === 'string'
        ) {
          await whatsappLifecycleService.handleMatchDecision(
            responseJson.flow_token,
            responseJson,
          );
        } else {
          console.warn('[whatsapp] unrecognized flow submission keys:', Object.keys(responseJson));
        }
      } catch (err) {
        // Always ACK the webhook; failures are logged and can be retried.
        console.error('[whatsapp] flow handling failed:', err);
      }
    }
  }

  res.status(200).json({ success: true });
}

/**
 * POST /trigger-onboarding — internal trigger that sends the onboarding Flow
 * inviting a user to confirm their search.
 */
export async function triggerOnboarding(req: Request, res: Response) {
  const { phone, name } = req.body as { phone: string; name: string };
  const result = await whatsappLifecycleService.triggerOnboarding({ phone, name });
  res.status(201).json({
    success: true,
    message: 'Onboarding flow sent successfully',
    data: result,
  });
}

/**
 * POST /trigger-match — internal trigger that sends the match decision Flow
 * presenting non-PII candidate details to the user.
 */
export async function triggerMatch(req: Request, res: Response) {
  const input = req.body as TriggerMatchInput;
  const result = await whatsappLifecycleService.triggerMatch(input);
  res.status(201).json({
    success: true,
    message: 'Match flow sent successfully',
    data: result,
  });
}
