import { Request, Response } from 'express';
import { whatsappService } from '../services/whatsapp.service.js';
import { whatsappHandoverService } from '../services/whatsappHandover.service.js';
import { supabase } from '../config/supabase.js';
import { HttpError } from '../middleware/errorHandler.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

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
 * dispatches Flow form submissions (nfm_reply) to the handover state machine.
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
      const isFlowReply =
        message?.type === 'interactive' &&
        message?.interactive?.type === 'nfm_reply' &&
        message?.interactive?.nfm_reply?.name === 'flow' &&
        typeof message?.interactive?.nfm_reply?.response_json === 'string';

      if (isFlowReply) {
        const responseJson = JSON.parse(
          message.interactive.nfm_reply.response_json,
        ) as Record<string, unknown>;
        const flowToken = responseJson?.flow_token;
        if (typeof flowToken === 'string') {
          try {
            await whatsappHandoverService.handleFlowResponse(flowToken, responseJson);
          } catch (err) {
            console.error('[whatsapp] flow handling failed:', err);
          }
        }
      }
    }
  }

  res.status(200).json({ success: true });
}

/**
 * POST /handovers/:matchId/start — admin retry/start for a confirmed match's
 * WhatsApp handover. Returns the created (or existing) handover.
 */
export const startHandover = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const matchId = req.params.matchId;

    const { data: match, error } = await supabase
      .from('roommate_matches')
      .select('id, roommate_profile_a_id, roommate_profile_b_id')
      .eq('id', matchId)
      .maybeSingle();

    if (error || !match) {
      throw new HttpError(404, 'Match not found');
    }

    await whatsappHandoverService.startHandover({
      id: match.id,
      roommate_profile_a_id: match.roommate_profile_a_id,
      roommate_profile_b_id: match.roommate_profile_b_id,
    });

    const { data: handover } = await supabase
      .from('match_whatsapp_handovers')
      .select('*')
      .eq('match_id', matchId)
      .maybeSingle();

    res.status(201).json({
      success: true,
      message: 'WhatsApp handover started successfully',
      data: handover,
    });
  },
);
