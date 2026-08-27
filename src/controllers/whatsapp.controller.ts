import { Request, Response } from 'express';
import { HttpError } from '../middleware/errorHandler.js';
import { whatsappService } from '../services/whatsapp.service.js';
import { whatsappLifecycleService } from '../services/whatsappLifecycle.service.js';
import type { TriggerMatchInput } from '../services/whatsappLifecycle.service.js';
import { normalizePhoneToE164 } from '../utils/normalizePhone.js';

const REGISTRATION_PREFILLED_TEXT =
  "Hi, I'd like to register for a roommate match.";

/**
 * GET /registration-link — public: returns the wa.me deep link the website
 * uses to send users into the Roommates NG WhatsApp chat to start
 * registration. Any message they send triggers the registration Flow.
 */
export async function getRegistrationLink(_req: Request, res: Response) {
  const businessPhone = (process.env.WHATSAPP_BUSINESS_PHONE_NUMBER ?? '').replace(/\D/g, '');
  if (businessPhone.length < 8) {
    throw new HttpError(500, 'WHATSAPP_BUSINESS_PHONE_NUMBER is not configured');
  }

  res.status(200).json({
    success: true,
    data: {
      url: `https://wa.me/${businessPhone}?text=${encodeURIComponent(REGISTRATION_PREFILLED_TEXT)}`,
    },
  });
}

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
 *   - flow == registration  -> 4-screen registration form
 *   - proceed_decision      -> onboarding response
 *   - accept_match          -> match decision
 */
export async function whatsappWebhookPost(req: Request, res: Response) {
  const rawBody = (res.locals.rawBody as string | undefined) ?? '';
  const signature = req.headers['x-hub-signature-256'] as string | undefined;

  const validSignature = whatsappService.verifyWebhookSignature(rawBody, signature);
  console.log('[whatsapp] webhook received', {
    validSignature,
    hasSignature: Boolean(signature),
  });

  if (!validSignature) {
    console.warn('[whatsapp] webhook signature rejected');
    res.status(401).json({ success: false, message: 'Invalid webhook signature' });
    return;
  }

  const payload = rawBody ? JSON.parse(rawBody) : {};
  const changes = payload?.entry?.[0]?.changes ?? [];

  for (const change of changes) {
    const messages = change?.value?.messages ?? [];
    const contacts = change?.value?.contacts ?? [];
    const contactName = (contacts?.[0]?.profile?.name as string | undefined) ?? 'Friend';

    for (const message of messages) {
      const from = String(message.from ?? '');

      // Plain-text inbound message (e.g. after tapping the wa.me link on the
      // website): auto-send the registration Flow to an unregistered user.
      if (message?.type === 'text') {
        try {
          const phoneE164 = normalizePhoneToE164(from);
          if (!phoneE164) {
            console.warn('[whatsapp] ignored text message without a valid sender phone');
            continue;
          }

          const action = await whatsappLifecycleService.autoSendRegistrationFlow(
            phoneE164,
            contactName,
          );
          console.log(`[whatsapp] text from ${phoneE164} -> ${action}`);

          if (action === 'already_registered') {
            await whatsappService.sendText(
              phoneE164,
              "You're all set with Roommates NG — your profile is already active. We'll ping you here on WhatsApp when we find a compatible roommate.",
            );
          } else if (action === 'recently_sent') {
            await whatsappService.sendText(
              phoneE164,
              "I just sent you the registration form — please fill it in 😊",
            );
          }
        } catch (err) {
          console.error('[whatsapp] auto registration flow failed:', err);
        }
        continue;
      }

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
        if (responseJson.flow === 'registration') {
          await whatsappLifecycleService.handleRegistrationResponse(
            String(message.from ?? ''),
            responseJson,
          );
        } else if (typeof responseJson.proceed_decision === 'string') {
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
 * POST /trigger-registration — internal trigger that sends the 4-screen
 * registration Flow so the user can build their full roommate profile.
 */
export async function triggerRegistration(req: Request, res: Response) {
  const { phone, name } = req.body as { phone: string; name: string };
  const result = await whatsappLifecycleService.triggerRegistration({ phone, name });
  res.status(201).json({
    success: true,
    message: 'Registration flow sent successfully',
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
