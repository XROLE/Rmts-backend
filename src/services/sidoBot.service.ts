import 'dotenv/config';
import { HttpError } from '../middleware/errorHandler.js';
import { supabase } from '../config/supabase.js';
import { whatsappService } from './whatsapp.service.js';
import { emailService } from './email.service.js';
import { SIDO_SYSTEM_PROMPT, SIDO_TOOLS } from '../knowledge/sido.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const OPENAI_TEMPERATURE = Number(process.env.OPENAI_TEMPERATURE ?? 0.7);
const OPENAI_MAX_TOKENS = Number(process.env.OPENAI_MAX_TOKENS ?? 300);
const SIDO_MAX_HISTORY = Number(process.env.SIDO_MAX_HISTORY ?? 30);
const SIDO_REGISTRATION_URL =
  process.env.SIDO_REGISTRATION_URL ?? 'https://urban-nest-tawny.vercel.app/';
/** When true, a human handover pauses Sido for that phone until resumed. */
const SIDO_HANDOVER_PAUSE_BOT = process.env.SIDO_HANDOVER_PAUSE_BOT === 'true';
/** Stale handovers auto-resume the bot after this window. */
const SIDO_HANDOVER_AUTO_RESUME_MS =
  Number(process.env.SIDO_HANDOVER_AUTO_RESUME_HOURS ?? 24) * 60 * 60 * 1000;

interface ConversationRow {
  phone: string;
  handed_off: boolean;
  handed_off_at: string | null;
}

interface HistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Sido — Roommates NG's WhatsApp AI assistant.
 *
 * Engages free-form text conversations with users who message the business
 * number. Conversation history is stored in sido_messages and trimmed to the
 * latest N messages per call. The model may trigger two tools:
 *   - send_registration_invite  -> sends a CTA button linking to the website
 *                                  profile-creation page
 *   - request_human_handover    -> notifies support of a soft handover; the bot
 *                                  keeps replying unless SIDO_HANDOVER_PAUSE_BOT
 *                                  is enabled (then it pauses until resumed)
 *
 * The bot never runs on a timer — it only ever replies immediately after an
 * inbound message, which is always inside the user's open 24-hour window.
 */
export class SidoBotService {
  /** Whether Sido is configured to run at all (key present + not disabled). */
  get enabled(): boolean {
    return process.env.SIDO_BOT_ENABLED !== 'false' && Boolean(OPENAI_API_KEY);
  }

  async handleInboundText(
    phoneE164: string,
    name: string,
    text: string,
    context?: string,
  ): Promise<void> {
    const conversation = await this.ensureConversation(phoneE164);
    // Optional situational context (e.g. the user just tapped a welcome
    // template button) is recorded as a system message BEFORE the user's
    // message so ordering in history is deterministic.
    if (context) await this.logMessage(phoneE164, 'system', context);
    await this.logMessage(phoneE164, 'user', text);
    await this.touchConversation(phoneE164);

    // When handover pausing is on, a human agent owns a handed-off chat and
    // Sido stays silent — except stale handovers auto-resume so chats never die.
    if (SIDO_HANDOVER_PAUSE_BOT && conversation.handed_off) {
      if (this.isHandoverStale(conversation)) {
        await this.resumeConversation(phoneE164);
        console.log(`[sido] ${phoneE164} handover stale; bot auto-resumed`);
      } else {
        console.log(`[sido] ${phoneE164} is handed off to a human; bot stays silent`);
        return;
      }
    }

    const history = await this.loadHistory(phoneE164, SIDO_MAX_HISTORY);
    const registered = (await this.findProfileByPhone(phoneE164)) !== null;

    let reply: string;
    try {
      reply = await this.complete(phoneE164, name, registered, history);
    } catch (err) {
      console.error('[sido] LLM call failed:', err);
      reply =
        "Sorry, I hit a small snag just now 🙈 Can you repeat that? Or type 'talk to human' and a person will help you.";
    }

    await whatsappService.sendText(phoneE164, reply);
    await this.logMessage(phoneE164, 'assistant', reply);
  }

  /** Resumes the bot for a conversation after a human agent closes the chat. */
  async resumeConversation(phoneE164: string, name?: string): Promise<void> {
    const now = new Date().toISOString();
    await supabase
      .from('sido_conversations')
      .update({ handed_off: false, resolved_at: now })
      .eq('phone', phoneE164);

    const { error } = await supabase
      .from('sido_human_handovers')
      .update({ status: 'resolved', resolved_at: now })
      .eq('phone', phoneE164)
      .eq('status', 'open');

    if (error) {
      throw new HttpError(500, `Failed to resolve handover: ${error.message}`);
    }

    if (name) {
      await whatsappService.sendText(
        phoneE164,
        `Hi ${name}, I'm Sido 👋 I'm back — how can I help you?`,
      );
    }
  }

  // ---------------------------------------------------------------
  // LLM plumbing
  // ---------------------------------------------------------------

  private async complete(
    phoneE164: string,
    name: string,
    registered: boolean,
    history: HistoryMessage[],
  ): Promise<string> {
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    const system = this.buildSystemPrompt(name, registered);

    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: OPENAI_TEMPERATURE,
        max_tokens: OPENAI_MAX_TOKENS,
        messages: [{ role: 'system', content: system }, ...history],
        tools: SIDO_TOOLS,
        tool_choice: 'auto',
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>;
    };

    if (!res.ok) {
      throw new Error(`OpenAI error (HTTP ${res.status}): ${data.error?.message ?? 'unknown'}`);
    }

    const message = data.choices?.[0]?.message;
    if (!message) throw new Error('OpenAI returned no message');

    const toolCall = message.tool_calls?.[0];
    if (toolCall?.function?.name) {
      return this.runTool(phoneE164, name, toolCall.function.name, toolCall.function.arguments ?? '{}');
    }

    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (content) return content;
    throw new Error('OpenAI returned empty content');
  }

  private buildSystemPrompt(name: string, registered: boolean): string {
    const status = registered
      ? '- The user is already registered (a roommate profile exists). Do not push registration; reassure them their profile is active and they will be notified on WhatsApp when a match is found.'
      : "- The user is NOT registered yet. If they ask about joining or want the registration form, use the send_registration_invite tool.";

    return `${SIDO_SYSTEM_PROMPT}

CURRENT USER CONTEXT
- User's name (from WhatsApp profile): ${name || 'unknown'}
- Registration status: ${registered ? 'registered' : 'not registered'}
${status}`;
  }

  // ---------------------------------------------------------------
  // Tool execution
  // ---------------------------------------------------------------

  private async runTool(
    phoneE164: string,
    name: string,
    toolName: string,
    argsJson: string,
  ): Promise<string> {
    if (toolName === 'send_registration_invite') {
      try {
        await whatsappService.sendCtaUrlButton({
          to: phoneE164,
          displayText: 'Create your profile',
          url: SIDO_REGISTRATION_URL,
          header: 'Create your profile 🏠',
          body: 'Set up your Roommates NG profile on the website — it takes under 2 minutes.',
        });
        return "I've sent you the link to create your profile 👆 Tap 'Create your profile' to get started 😊";
      } catch (err) {
        console.error('[sido] failed to send registration link:', err);
        return "Sorry, I couldn't send the registration link just now 🙈 Please try again in a moment, or type 'talk to human' if you'd like a person to help you.";
      }
    }

    if (toolName === 'request_human_handover') {
      let summary = '';
      try {
        const parsed = JSON.parse(argsJson ?? '{}') as { summary?: unknown };
        summary = String(parsed.summary ?? '').trim().slice(0, 200);
      } catch {
        // keep empty summary
      }
      await this.performHandover(phoneE164, name, summary);
      return "Alright — I've put you through to a person on our team. A human agent will reply right here on WhatsApp shortly 🙂";
    }

    throw new Error(`Unknown Sido tool: ${toolName}`);
  }

  private async performHandover(phoneE164: string, name: string, summary: string) {
    // Only silence the bot for this conversation when pausing is enabled.
    // In development the bot keeps replying; the handover still records a
    // ticket and pings support so a human can jump in when ready.
    if (SIDO_HANDOVER_PAUSE_BOT) {
      await supabase
        .from('sido_conversations')
        .update({ handed_off: true, handed_off_at: new Date().toISOString() })
        .eq('phone', phoneE164);
    }

    const { error } = await supabase
      .from('sido_human_handovers')
      .insert({ phone: phoneE164, summary, status: 'open' });

    if (error) {
      throw new HttpError(500, `Failed to record handover: ${error.message}`);
    }

    emailService
      .sendHumanHandover({ phone: phoneE164, name: name || 'Unknown', summary })
      .catch((err) => console.error('[sido] failed to email handover:', err));
  }

  // ---------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------

  private async ensureConversation(phoneE164: string): Promise<ConversationRow> {
    const { data, error } = await supabase
      .from('sido_conversations')
      .upsert({ phone: phoneE164 }, { onConflict: 'phone' })
      .select('phone, handed_off, handed_off_at')
      .single();

    if (error || !data) {
      throw new HttpError(500, `Failed to open conversation: ${error?.message}`);
    }
    return data as ConversationRow;
  }

  private isHandoverStale(conversation: ConversationRow): boolean {
    if (!conversation.handed_off_at) return true;
    return (
      Date.now() - new Date(conversation.handed_off_at).getTime() >=
      SIDO_HANDOVER_AUTO_RESUME_MS
    );
  }

  private async touchConversation(phoneE164: string) {
    const { error } = await supabase
      .from('sido_conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('phone', phoneE164);
    if (error) {
      console.error('[sido] failed to touch conversation:', error.message);
    }
  }

  private async logMessage(phoneE164: string, role: string, content: string) {
    const { error } = await supabase
      .from('sido_messages')
      .insert({ phone: phoneE164, role, content });
    if (error) {
      console.error('[sido] failed to log message:', error.message);
    }
  }

  private async loadHistory(phoneE164: string, limit: number): Promise<HistoryMessage[]> {
    const { data, error } = await supabase
      .from('sido_messages')
      .select('role, content')
      .eq('phone', phoneE164)
      .in('role', ['user', 'assistant', 'system'])
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new HttpError(500, `Failed to load conversation history: ${error.message}`);
    }

    return ((data ?? []) as Array<{ role: string; content: string }>)
      .map((m) => ({ role: m.role as HistoryMessage['role'], content: m.content }))
      .reverse();
  }

  private async findProfileByPhone(phoneE164: string): Promise<{ id: string } | null> {
    const { data, error } = await supabase
      .from('roommate_profiles')
      .select('id')
      .eq('phone_number', phoneE164)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Failed to look up existing profile: ${error.message}`);
    }
    return (data as { id: string } | null) ?? null;
  }
}

export const sidoBotService = new SidoBotService();