import 'dotenv/config';
import { HttpError } from '../middleware/errorHandler.js';
import { supabase } from '../config/supabase.js';
import { whatsappService } from './whatsapp.service.js';
import { whatsappLifecycleService } from './whatsappLifecycle.service.js';
import { emailService } from './email.service.js';
import { SIDO_SYSTEM_PROMPT, SIDO_TOOLS } from '../knowledge/sido.js';
import { phoneLookupVariants } from '../utils/normalizePhone.js';
import { getSiteBaseUrl } from '../config/site.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const OPENAI_TEMPERATURE = Number(process.env.OPENAI_TEMPERATURE ?? 0.7);
const OPENAI_MAX_TOKENS = Number(process.env.OPENAI_MAX_TOKENS ?? 300);
const SIDO_MAX_HISTORY = Number(process.env.SIDO_MAX_HISTORY ?? 30);
/** Randomized composing delay before Sido's reply lands (ms) — simulates typing. */
const SIDO_REPLY_DELAY_MIN_MS = Number(process.env.SIDO_REPLY_DELAY_MIN_MS ?? 800);
const SIDO_REPLY_DELAY_MAX_MS = Number(process.env.SIDO_REPLY_DELAY_MAX_MS ?? 1800);
/** When true, a human handover pauses Sido for that phone until resumed. */
const SIDO_HANDOVER_PAUSE_BOT = process.env.SIDO_HANDOVER_PAUSE_BOT === 'true';
/** Stale handovers auto-resume the bot after this window. */
const SIDO_HANDOVER_AUTO_RESUME_MS =
  Number(process.env.SIDO_HANDOVER_AUTO_RESUME_HOURS ?? 24) * 60 * 60 * 1000;

interface ConversationRow {
  phone: string;
  handed_off: boolean;
  handed_off_at: string | null;
  awaiting_payment_confirm: boolean;
  payment_confirm_code: string | null;
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

    // Pending service-fee confirmation: the user previously asked for a payment
    // link and was given a one-time code. If they now type that code, generate
    // and send the link. Otherwise re-prompt with the code. This short-circuits
    // the LLM so the code is matched deterministically.
    if (conversation.awaiting_payment_confirm && conversation.payment_confirm_code) {
      const typed = (text ?? '').trim().toUpperCase();
      if (typed && typed === conversation.payment_confirm_code.toUpperCase()) {
        await this.clearPaymentConfirm(phoneE164);
        try {
          await whatsappLifecycleService.issueStandaloneServiceFeeLink(phoneE164, name);
          await this.logMessage(
            phoneE164,
            'assistant',
            'Sent the ₦2,750 service-fee payment link (Paystack CTA).',
          );
        } catch (err) {
          console.error('[sido] failed to issue service-fee link:', err);
          const fallback =
            "Sorry, I couldn't generate your payment link just now 🙈 Please try again in a moment, or type 'talk to human' for help.";
          await whatsappService.sendText(phoneE164, fallback);
          await this.logMessage(phoneE164, 'assistant', fallback);
        }
        return;
      }

      const rePrompt = `That doesn't match the code. To get your ₦2,750 service-fee payment link, please reply with this exact code: ${conversation.payment_confirm_code}`;
      await whatsappService.sendText(phoneE164, rePrompt);
      await this.logMessage(phoneE164, 'assistant', rePrompt);
      return;
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

    // Simulate a human typing: randomized pause before the reply lands.
    if (SIDO_REPLY_DELAY_MAX_MS > SIDO_REPLY_DELAY_MIN_MS) {
      const delay =
        SIDO_REPLY_DELAY_MIN_MS +
        Math.random() * (SIDO_REPLY_DELAY_MAX_MS - SIDO_REPLY_DELAY_MIN_MS);
      await this.sleep(delay);
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
        await this.sendRegistrationInvite(phoneE164);
        return "I've sent you the link to create your profile 👆 Tap 'Create your profile' to get started 😊";
      } catch (err) {
        console.error('[sido] failed to send registration link:', err);
        return "Sorry, I couldn't send the registration link just now 🙈 Please try again in a moment, or type 'talk to human' if you'd like a person to help you.";
      }
    }

    if (toolName === 'send_update_request_link') {
      return this.sendUpdateRequestLink(phoneE164);
    }

    if (toolName === 'request_payment_link') {
      return this.beginPaymentLinkConfirmation(phoneE164);
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

  /**
   * Starts the service-fee payment-link flow: generates a one-time confirmation
   * code, stores it on the conversation, and returns the message Sido should
   * send asking the user to type the code back before a link is issued.
   */
  private async beginPaymentLinkConfirmation(phoneE164: string): Promise<string> {
    const code = this.generateConfirmCode();
    await this.setPaymentConfirm(phoneE164, code);
    return (
      `Here is your one-time confirmation code to generate your ₦2,750 service-fee payment link:\n\n` +
      `*${code}*\n\n` +
      `Reply with this exact code to receive your secure Paystack payment link. ` +
      `(The code expires once used or when you start a new request.)`
    );
  }

  /** Generates a 6-character uppercase-alphanumeric confirmation code. */
  private generateConfirmCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return code;
  }

  private async setPaymentConfirm(phoneE164: string, code: string): Promise<void> {
    const { error } = await supabase
      .from('sido_conversations')
      .update({
        awaiting_payment_confirm: true,
        payment_confirm_code: code,
        updated_at: new Date().toISOString(),
      })
      .eq('phone', phoneE164);
    if (error) {
      console.error('[sido] failed to set payment confirm:', error.message);
    }
  }

  private async clearPaymentConfirm(phoneE164: string): Promise<void> {
    const { error } = await supabase
      .from('sido_conversations')
      .update({
        awaiting_payment_confirm: false,
        payment_confirm_code: null,
        updated_at: new Date().toISOString(),
      })
      .eq('phone', phoneE164);
    if (error) {
      console.error('[sido] failed to clear payment confirm:', error.message);
    }
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

  /** Sends the "Create your profile" CTA button pointing at the website. */
  private async sendRegistrationInvite(phoneE164: string): Promise<void> {
    await whatsappService.sendCtaUrlButton({
      to: phoneE164,
      displayText: 'Create your profile',
      url: `${getSiteBaseUrl()}/`,
      header: 'Create your profile 🏠',
      body: 'Set up your Roommates NG profile on the website — it takes under 2 minutes.',
    });
  }

  /**
   * Builds a personalized /update-request deep link for the requesting user
   * and sends it as a clickable text message. The profile is looked up by the
   * WhatsApp sender's phone number; the link is pre-filled with the user's
   * stored phone, state, budget range and preferred locations so the form can
   * be pre-populated on the website.
   */
  private async sendUpdateRequestLink(phoneE164: string): Promise<string> {
    const profile = await this.findProfileForUpdateLink(phoneE164);

    if (!profile) {
      try {
        await this.sendRegistrationInvite(phoneE164);
      } catch (err) {
        console.error('[sido] failed to send registration link:', err);
      }
      return "I couldn't find an active roommate request on this number, so I've sent you the registration link instead 👆 Once you're registered, just message me and I'll get you the update link 😊";
    }

    const params = new URLSearchParams();
    params.set('phone', profile.phone_number);
    params.set('state', profile.state);
    params.set('minBudget', String(profile.budget_min));
    params.set('maxBudget', String(profile.budget_max));
    params.set('locations', (profile.preferred_locations ?? []).join(','));

    const url = `${getSiteBaseUrl()}/update-request?${params.toString()}`;

    try {
      await whatsappService.sendText(
        phoneE164,
        `Here's your link to update your roommate request 🔗\n${url}\n\nYou can adjust your budget and preferred locations there. Your state (${profile.state}) stays fixed for same-state matching.`,
      );
    } catch (err) {
      console.error('[sido] failed to send update-request link:', err);
      return "Sorry, I couldn't send the update link just now 🙈 Please try again in a moment, or type 'talk to human' if you'd like a person to help you.";
    }

    return "I've sent your update link above 👆 Tap it to edit your budget and preferred locations 😊";
  }

  /**
   * Looks up the fields needed to build the update-request link for a phone
   * number. Returns null when no roommate profile exists for the number.
   */
  private async findProfileForUpdateLink(
    phoneE164: string,
  ): Promise<{
    phone_number: string;
    state: string;
    budget_min: number;
    budget_max: number;
    preferred_locations: string[] | null;
  } | null> {
    const variants = phoneLookupVariants(phoneE164);

    const { data, error } = await supabase
      .from('roommate_profiles')
      .select('phone_number, state, budget_min, budget_max, preferred_locations')
      .in('phone_number', variants)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Failed to look up profile: ${error.message}`);
    }
    return (data as
      | {
          phone_number: string;
          state: string;
          budget_min: number;
          budget_max: number;
          preferred_locations: string[] | null;
        }
      | null) ?? null;
  }

  // ---------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------

  private async ensureConversation(phoneE164: string): Promise<ConversationRow> {
    const { data, error } = await supabase
      .from('sido_conversations')
      .upsert({ phone: phoneE164 }, { onConflict: 'phone' })
      .select('phone, handed_off, handed_off_at, awaiting_payment_confirm, payment_confirm_code')
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    const variants = phoneLookupVariants(phoneE164);

    const { data, error } = await supabase
      .from('roommate_profiles')
      .select('id')
      .in('phone_number', variants)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Failed to look up existing profile: ${error.message}`);
    }
    return (data as { id: string } | null) ?? null;
  }

  // ---------------------------------------------------------------
  // Admin: read-only exports for the Sido chat viewer
  // ---------------------------------------------------------------

  /**
   * Lists every Sido conversation (one per WhatsApp phone) with enough metadata
   * to render a chat-list UI. Message counts and the first/last timestamps are
   * derived from the visible turns only (user + assistant), and each
   * conversation is best-effort enriched with the seeker's profile name/state.
   *
   * Returns keyset-paginated results: pass the `nextCursor` from a previous
   * call back as `cursor` to fetch the following page. `nextCursor` is null
   * once the final page has been returned.
   */
  async listConversations(
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<{
    items: Array<{
      phone: string;
      name: string | null;
      state: string | null;
      handedOff: boolean;
      messageCount: number;
      firstMessageAt: string | null;
      lastMessageAt: string | null;
    }>;
    nextCursor: string | null;
  }> {
    const limit = clamp(opts.limit ?? 50, 1, 200);
    const pageSize = limit + 1; // over-fetch one row to detect hasMore
    const decoded = decodeCursor<{ ts: string; phone: string }>(opts.cursor);

    let query = supabase
      .from('sido_conversations')
      .select('phone, handed_off, last_message_at, created_at')
      .order('last_message_at', { ascending: false })
      .order('phone', { ascending: false })
      .limit(pageSize);

    // Keyset: rows strictly "older" than the cursor in (last_message_at, phone).
    if (decoded?.ts && decoded?.phone) {
      query = query.or(
        `last_message_at.lt.${decoded.ts},and(last_message_at.eq.${decoded.ts},phone.lt.${decoded.phone})`,
      );
    }

    const { data: conversations, error: convError } = await query;

    if (convError) {
      throw new HttpError(500, `Failed to list conversations: ${convError.message}`);
    }

    let rows = (conversations ?? []) as Array<{
      phone: string;
      handed_off: boolean;
      last_message_at: string;
      created_at: string;
    }>;

    const hasMore = rows.length > limit;
    if (hasMore) rows = rows.slice(0, limit);

    if (rows.length === 0) {
      return { items: [], nextCursor: null };
    }

    // Aggregate visible-turn stats (user + assistant) for the listed phones in
    // a single query, then group in memory.
    const phones = rows.map((r) => r.phone);
    const { data: messages, error: msgError } = await supabase
      .from('sido_messages')
      .select('phone, role, created_at')
      .in('phone', phones)
      .in('role', ['user', 'assistant'])
      .order('created_at', { ascending: true });

    if (msgError) {
      throw new HttpError(500, `Failed to load conversation stats: ${msgError.message}`);
    }

    const stats = new Map<
      string,
      { messageCount: number; firstMessageAt: string | null; lastMessageAt: string | null }
    >();
    for (const m of messages ?? []) {
      const entry = stats.get(m.phone) ?? {
        messageCount: 0,
        firstMessageAt: null,
        lastMessageAt: null,
      };
      entry.messageCount += 1;
      entry.firstMessageAt = entry.firstMessageAt ?? m.created_at;
      entry.lastMessageAt = m.created_at;
      stats.set(m.phone, entry);
    }

    // Best-effort enrichment from roommate_profiles (name/state by phone).
    const allVariants = phones.flatMap((p) => phoneLookupVariants(p));
    const { data: profiles, error: profileError } = await supabase
      .from('roommate_profiles')
      .select('phone_number, full_name, state')
      .in('phone_number', allVariants);

    if (profileError) {
      throw new HttpError(500, `Failed to look up profiles: ${profileError.message}`);
    }

    const profileByPhone = new Map<string, { name: string; state: string | null }>();
    const variantToPhone = new Map<string, string>();
    for (const p of phones) {
      for (const v of phoneLookupVariants(p)) variantToPhone.set(v, p);
    }
    for (const profile of profiles ?? []) {
      const phone = variantToPhone.get(profile.phone_number);
      if (phone && !profileByPhone.has(phone)) {
        profileByPhone.set(phone, {
          name: profile.full_name,
          state: (profile.state as string | null) ?? null,
        });
      }
    }

    const items = rows.map((r) => {
      const stat = stats.get(r.phone);
      const profile = profileByPhone.get(r.phone);
      return {
        phone: r.phone,
        name: profile?.name ?? null,
        state: profile?.state ?? null,
        handedOff: r.handed_off,
        messageCount: stat?.messageCount ?? 0,
        firstMessageAt: stat?.firstMessageAt ?? r.created_at,
        lastMessageAt: stat?.lastMessageAt ?? r.last_message_at,
      };
    });

    const last = rows[rows.length - 1];
    const nextCursor = hasMore
      ? encodeCursor({ ts: last.last_message_at, phone: last.phone })
      : null;

    return { items, nextCursor };
  }

  /**
   * Returns the visible (user + assistant) messages for a single Sido
   * conversation, ready to render as a chat thread.
   *
   * Pagination is keyset-based on (created_at, id):
   *  - Without `cursor`: returns the newest `limit` messages (chronological
   *    order, oldest first) so the thread opens at the bottom.
   *  - With `cursor` (the `nextCursor` from a previous call): returns the page
   *    of messages *older* than that cursor, for scroll-up / infinite loading.
   * `nextCursor` is null once the oldest messages have been returned.
   */
  async getConversationMessages(
    phoneE164: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<{
    phone: string;
    name: string | null;
    state: string | null;
    handedOff: boolean;
    messages: Array<{ id: string; role: string; content: string; createdAt: string }>;
    nextCursor: string | null;
  }> {
    const limit = clamp(opts.limit ?? 50, 1, 1000);
    const pageSize = limit + 1; // over-fetch one row to detect hasMore
    const decoded = decodeCursor<{ ts: string; id: string }>(opts.cursor);

    const { data: conversation, error: convError } = await supabase
      .from('sido_conversations')
      .select('phone, handed_off')
      .eq('phone', phoneE164)
      .maybeSingle();

    if (convError) {
      throw new HttpError(500, `Failed to load conversation: ${convError.message}`);
    }
    if (!conversation) {
      throw new HttpError(404, 'No Sido conversation found for this phone number');
    }

    const baseQuery = () =>
      supabase
        .from('sido_messages')
        .select('id, role, content, created_at')
        .eq('phone', phoneE164)
        .in('role', ['user', 'assistant']);

    let fetched: Array<{ id: string; role: string; content: string; created_at: string }>;

    if (decoded?.ts && decoded?.id) {
      // Older-than-cursor page: strictly before (created_at, id), oldest first.
      const { data, error: msgError } = await baseQuery()
        .or(`created_at.lt.${decoded.ts},and(created_at.eq.${decoded.ts},id.lt.${decoded.id})`)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(pageSize);
      if (msgError) throw new HttpError(500, `Failed to load messages: ${msgError.message}`);
      fetched = (data ?? []) as typeof fetched;
    } else {
      // Newest page: take the tail, then reverse to chronological order.
      const { data, error: msgError } = await baseQuery()
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(pageSize);
      if (msgError) throw new HttpError(500, `Failed to load messages: ${msgError.message}`);
      fetched = ((data ?? []) as typeof fetched).reverse();
    }

    const hasMore = fetched.length > limit;
    if (hasMore) fetched = fetched.slice(0, limit);

    const { data: profile, error: profileError } = await supabase
      .from('roommate_profiles')
      .select('full_name, state')
      .in('phone_number', phoneLookupVariants(phoneE164))
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (profileError) {
      throw new HttpError(500, `Failed to look up profile: ${profileError.message}`);
    }

    const messages = fetched.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.created_at,
    }));

    // nextCursor is the oldest returned message (the boundary for the next
    // older page). It is only set when there are actually more messages to
    // page through (hasMore).
    const oldest = fetched[0];
    const nextCursor =
      hasMore && messages.length > 0
        ? encodeCursor({ ts: oldest.created_at, id: oldest.id })
        : null;

    return {
      phone: phoneE164,
      name: (profile?.full_name as string | undefined) ?? null,
      state: (profile?.state as string | null) ?? null,
      handedOff: (conversation as { handed_off: boolean }).handed_off,
      messages,
      nextCursor,
    };
  }
}

/** Clamps a number between min and max, ignoring non-finite values. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return max;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** Encodes a cursor payload into an opaque, URL-safe base64 string. */
function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** Decodes an opaque cursor string back into its payload, or null if invalid. */
function decodeCursor<T = Record<string, unknown>>(cursor?: string | null): T | null {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

export const sidoBotService = new SidoBotService();