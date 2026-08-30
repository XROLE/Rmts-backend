import { Request, Response } from 'express';
import { HttpError } from '../middleware/errorHandler.js';
import { supabase } from '../config/supabase.js';
import { whatsappService } from '../services/whatsapp.service.js';
import { whatsappLifecycleService } from '../services/whatsappLifecycle.service.js';
import type { TriggerMatchInput } from '../services/whatsappLifecycle.service.js';
import { sidoBotService } from '../services/sidoBot.service.js';
import { normalizePhoneToE164, normalizeAnyPhoneToE164 } from '../utils/normalizePhone.js';

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

      // Plain-text inbound message. A text message opens (or stays inside) the
      // 24-hour customer service window, so we may reply with free-form content.
      if (message?.type === 'text') {
        // Accept any international number so foreign/test users still reach
        // Sido; Nigerian numbers keep their strict +234 form.
        const phoneE164 = normalizeAnyPhoneToE164(from);
        if (!phoneE164) {
          console.warn('[whatsapp] ignored text message without a valid sender phone');
          continue;
        }

        // Dedup + audit inbound delivery via whatsapp_messages (wam_id PK). If the
        // row already exists Meta re-delivered this message, so skip it.
        const messageId = String(message.id ?? '');
        if (messageId) {
          const { data: inserted, error: logError } = await supabase
            .from('whatsapp_messages')
            .upsert(
              {
                wam_id: messageId,
                phone: phoneE164,
                direction: 'inbound',
                message_type: message.type,
                payload: { text: message.text?.body ?? '', profile_name: contactName },
              },
              { onConflict: 'wam_id', ignoreDuplicates: true },
            )
            .select('wam_id');

          if (logError) {
            console.error('[whatsapp] failed to log inbound message:', logError.message);
          } else if (!inserted || inserted.length === 0) {
            console.log(`[whatsapp] duplicate delivery skipped: ${messageId}`);
            continue;
          }
        }

        const text = String(message.text?.body ?? '');

        // Sido (AI assistant) takes over conversational replies whenever it is
        // configured. Process in the background so Meta's webhook ACKs instantly.
        if (sidoBotService.enabled) {
          console.log(`[whatsapp] text from ${phoneE164} -> sido bot`);
          void sidoBotService
            .handleInboundText(phoneE164, contactName, text)
            .catch((err) => console.error('[whatsapp] sido bot failed:', err));
          continue;
        }

        // Fallback (bot disabled or key missing): legacy greeting/dedup path.
        try {
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

      // Template quick-reply button press (welcome_to_roommate_ng):
      // confirm/decline the roommate request, then hand the next reply to Sido.
      if (message?.type === 'button') {
        const phoneE164 = normalizeAnyPhoneToE164(from);
        if (!phoneE164) {
          console.warn('[whatsapp] ignored button message without a valid sender phone');
          continue;
        }

        const buttonText = String(message.button?.text ?? '');
        const payload = String(message.button?.payload ?? '');

        const messageId = String(message.id ?? '');
        if (messageId) {
          const { data: inserted, error: logError } = await supabase
            .from('whatsapp_messages')
            .upsert(
              {
                wam_id: messageId,
                phone: phoneE164,
                direction: 'inbound',
                message_type: 'button',
                payload: { text: buttonText, payload },
              },
              { onConflict: 'wam_id', ignoreDuplicates: true },
            )
            .select('wam_id');

          if (logError) {
            console.error('[whatsapp] failed to log inbound button message:', logError.message);
          } else if (!inserted || inserted.length === 0) {
            console.log(`[whatsapp] duplicate button delivery skipped: ${messageId}`);
            continue;
          }
        }

        try {
          const result = await whatsappLifecycleService.handleWelcomeButtonReply(
            phoneE164,
            buttonText,
            payload,
          );
          console.log(`[whatsapp] button from ${phoneE164} ->`, result);

          if (sidoBotService.enabled && result?.handled) {
            const context =
              result.outcome === 'confirmed'
                ? "The user just tapped the 'Yes, start matching' button on the welcome_to_roommate_ng template. Their Roommates NG profile is confirmed, active and now in the matching queue. Reply warmly to confirm this and explain what happens next."
                : result.outcome === 'declined'
                  ? "The user just tapped the 'No, I didn't request this' button on the welcome_to_roommate_ng template. Their profile was marked inactive so it will not be matched. Acknowledge politely, ask if someone else may have used their number, and let them know they can register again anytime."
                  : undefined;

            void sidoBotService
              .handleInboundText(phoneE164, contactName, buttonText, context)
              .catch((err) => console.error('[whatsapp] sido bot failed after button:', err));
          }
        } catch (err) {
          console.error('[whatsapp] welcome button handling failed:', err);
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

/**
 * POST /bot/resume — admin. Re-enables Sido for a conversation after a human
 * agent has finished replying to the user from the business number.
 */
export async function resumeBot(req: Request, res: Response) {
  const { phone } = req.body as { phone: string };
  const phoneE164 = normalizePhoneToE164(phone);
  if (!phoneE164) {
    throw new HttpError(400, 'A valid Nigerian phone number is required');
  }

  await sidoBotService.resumeConversation(phoneE164);
  res.status(200).json({
    success: true,
    message: 'Bot resumed for this conversation',
  });
}

/**
 * GET /bot/conversations — admin. Lists Sido <-> user handovers so agents can
 * follow up on chats flagged for human assistance.
 */
export async function listBotConversations(req: Request, res: Response) {
  const { status } = req.query as { status?: string };

  let query = supabase
    .from('sido_human_handovers')
    .select('id, phone, summary, status, created_at, resolved_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (status === 'open' || status === 'resolved') {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    throw new HttpError(500, `Failed to list handovers: ${error.message}`);
  }

  res.status(200).json({ success: true, data: data ?? [] });
}
