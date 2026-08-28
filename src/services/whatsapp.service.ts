import 'dotenv/config';
import { createHmac } from 'node:crypto';
import { HttpError } from '../middleware/errorHandler.js';
import { supabase } from '../config/supabase.js';

const GRAPH_VERSION = process.env.WHATSAPP_API_VERSION ?? 'v21.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

function accessToken(): string {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) {
    throw new HttpError(500, 'WHATSAPP_ACCESS_TOKEN is not configured');
  }
  return token;
}

function phoneNumberId(): string {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!id) {
    throw new HttpError(500, 'WHATSAPP_PHONE_NUMBER_ID is not configured');
  }
  return id;
}

interface SendFlowMessageInput {
  to: string;
  flowId: string;
  cta: string;
  body: string;
  header?: string;
  flowToken: string;
  initialData?: Record<string, unknown>;
  screen?: string;
}

interface SendCtaUrlInput {
  to: string;
  displayText: string;
  url: string;
  body: string;
  header?: string;
}

/**
 * Thin client for the Meta WhatsApp Business Cloud API. Handles text
 * messages, interactive Flow messages and CTA URL buttons, and verifies
 * webhook signatures. Every outbound message is recorded in
 * whatsapp_messages for audit + dedup.
 */
export class WhatsAppService {
  /** Sends a plain text message. */
  async sendText(to: string, body: string) {
    const message: Record<string, unknown> = {
      recipient_type: 'individual',
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { preview_url: true, body },
    };
    return this.postMessage(to, message);
  }

  /**
   * Sends an interactive "flow" message (the newer WhatsApp Flows design).
   * The flow_token round-trips back in the nfm_reply response_json so inbound
   * submissions can be attributed to a match/user.
   */
  async sendFlowMessage(input: SendFlowMessageInput) {
    const message: Record<string, unknown> = {
      recipient_type: 'individual',
      messaging_product: 'whatsapp',
      to: input.to,
      type: 'interactive',
      interactive: {
        type: 'flow',
        header: { type: 'text', text: input.header ?? input.cta },
        body: { text: input.body },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            flow_id: input.flowId,
            flow_token: input.flowToken,
            flow_cta: input.cta,
            flow_action: 'navigate',
            flow_action_payload: {
              screen: input.screen ?? 'FIRST_ENTRY_SCREEN',
              data: JSON.stringify(input.initialData ?? {}),
            },
          },
        },
      },
    };
    const { wamId } = await this.postMessage(input.to, message);
    return { wamId };
  }

  /**
   * Sends an interactive CTA URL button (tap-to-open) — used to deliver the
   * Paystack payment link after a user accepts a match.
   */
  async sendCtaUrlButton(input: SendCtaUrlInput) {
    const message: Record<string, unknown> = {
      recipient_type: 'individual',
      messaging_product: 'whatsapp',
      to: input.to,
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        ...(input.header ? { header: { type: 'text', text: input.header } } : {}),
        body: { text: input.body },
        action: {
          name: 'cta_url',
          parameters: {
            display_text: input.displayText,
            url: input.url,
          },
        },
      },
    };
    const { wamId } = await this.postMessage(input.to, message);
    return { wamId };
  }

  /**
   * Verifies the X-Hub-Signature-256 header against the raw body using the
   * Meta app secret (HMAC-SHA256, sha256=... format).
   */
  verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (!appSecret || !signature) return false;

    const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
    return expected === signature;
  }

  private async postMessage(to: string, message: Record<string, unknown>) {
    const res = await fetch(`${GRAPH_BASE_URL}/${phoneNumberId()}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const body = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>;
      error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
    };

    if (!res.ok) {
      const { code, error_subcode, message, fbtrace_id } = body.error ?? {};
      throw new HttpError(
        502,
        `WhatsApp send failed (HTTP ${res.status}${code ? ` code=${code}` : ''}${error_subcode ? ` subcode=${error_subcode}` : ''}): ${message ?? 'unknown error'}` +
          (fbtrace_id ? ` [fbtrace: ${fbtrace_id}]` : ''),
      );
    }

    const wamId = body.messages?.[0]?.id ?? null;

    await this.logOutbound(to, wamId, String(message.type ?? 'unknown'), message);

    return { wamId };
  }

  private async logOutbound(
    phone: string | null,
    wamId: string | null,
    messageType: string,
    payload: Record<string, unknown>,
  ) {
    const { error } = await supabase.from('whatsapp_messages').insert({
      wam_id: wamId,
      phone,
      direction: 'outbound',
      message_type: messageType,
      payload,
    });
    if (error) {
      console.error('[whatsapp] failed to log outbound message:', error.message);
    }
  }
}

export const whatsappService = new WhatsAppService();
