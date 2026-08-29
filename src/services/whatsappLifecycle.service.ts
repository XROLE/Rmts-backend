import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { HttpError } from '../middleware/errorHandler.js';
import { supabase } from '../config/supabase.js';
import { whatsappService } from './whatsapp.service.js';
import { paystackService } from './paystack.service.js';
import { normalizePhoneToE164 } from '../utils/normalizePhone.js';

const FLOW_ONBOARDING_ID = process.env.WHATSAPP_FLOW_ONBOARDING_ID ?? '';
const FLOW_MATCH_ID = process.env.WHATSAPP_FLOW_MATCH_ID ?? '';
const FLOW_REGISTRATION_ID = process.env.WHATSAPP_FLOW_REGISTRATION_ID ?? '';

/** 'flow' sends the interactive Flow; 'template' sends an approved message template. */
const REGISTRATION_CHANNEL = process.env.WHATSAPP_REGISTRATION_CHANNEL ?? 'flow';
const REGISTRATION_TEMPLATE_NAME =
  process.env.WHATSAPP_REGISTRATION_TEMPLATE_NAME ?? 'hello_world';
const REGISTRATION_TEMPLATE_LANG = process.env.WHATSAPP_REGISTRATION_TEMPLATE_LANG ?? 'en_US';
/** Number of {{N}} body placeholders to fill with the user's name (0 = send none). */
const REGISTRATION_TEMPLATE_PARAMS = Number(
  process.env.WHATSAPP_REGISTRATION_TEMPLATE_PARAMS ?? 0,
);

const REGISTRATION_GENDERS = ['male', 'female'] as const;
const REGISTRATION_MARITAL_STATUS = ['single', 'married', 'divorced'] as const;
const REGISTRATION_RELIGIONS = ['Christianity', 'Islam', 'Others'] as const;
const REGISTRATION_OCCUPATIONS = [
  'student',
  'nysc',
  'working_professional',
  'self_employed',
  'job_seeker',
] as const;
const REGISTRATION_SMOKING_HABITS = ['non_smoker', 'occasional_smoker', 'regular_smoker'] as const;
const MATCH_PAYMENT_AMOUNT_NGN = Number(
  process.env.WHATSAPP_MATCH_PAYMENT_AMOUNT_NGN ?? 2000,
);
const PAYMENT_RETURN_URL = process.env.PAYMENT_RETURN_URL;
const REPLACEMENT_FORM_BASE_URL =
  process.env.REPLACEMENT_FORM_BASE_URL ?? 'https://roommate.ng/request-replacement';
/** Minimum gap between automatic registration Flow sends to the same phone. */
const REGISTRATION_RESEND_WINDOW_MS = 15 * 60 * 1000;

const DECLINE_REASONS = [
  'BUDGET_MISMATCH',
  'LOCATION_PREFERENCE',
  'TIMING_ISSUE',
  'OTHER',
] as const;

type MatchStatus = 'PROPOSED' | 'ACCEPTED' | 'REJECTED' | 'UNLOCKED';

interface UserRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  whatsapp_number: string | null;
}

interface MatchRow {
  id: string;
  user_phone: string;
  candidate_id: string | null;
  compatibility_score: number | null;
  status: MatchStatus;
  rejection_reason: string | null;
  flow_token: string | null;
}

export interface TriggerMatchInput {
  matchId?: string;
  userPhone: string;
  userName: string;
  compatibilityScore: number;
  location: string;
  budget: number;
  moveInDate: string;
  candidateId?: string;
}

function syntheticEmail(phoneE164: string): string {
  return `${phoneE164.replace(/\D/g, '')}@wa.roommateng.com`;
}

function naira(amountNg: number): string {
  return `₦${amountNg.toLocaleString('en-NG')}`;
}

/**
 * WhatsApp-led roommate lifecycle engine:
 *   trigger-onboarding -> proceed_decision -> ACTIVE_SEARCH / OPTED_OUT
 *   trigger-match      -> accept_match     -> ACCEPTED + Paystack ₦2,000 link
 *                          (charge.success) -> UNLOCKED + PII/safety/rematch DMs
 */
export class WhatsAppLifecycleService {
  // ---------------------------------------------------------------
  // Outbound triggers
  // ---------------------------------------------------------------

  /**
   * Sends the onboarding Flow inviting the user to confirm their search and
   * informing them of the single ₦2,000 fee policy.
   */
  async triggerOnboarding(input: { phone: string; name: string }) {
    if (!FLOW_ONBOARDING_ID) {
      throw new HttpError(500, 'WHATSAPP_FLOW_ONBOARDING_ID is not configured');
    }

    const phoneE164 = normalizePhoneToE164(input.phone);
    if (!phoneE164) {
      throw new HttpError(400, 'A valid Nigerian phone number is required');
    }

    await this.ensureUser(phoneE164, input.name);

    const flowToken = randomUUID();
    await whatsappService.sendFlowMessage({
      to: phoneE164,
      flowId: FLOW_ONBOARDING_ID,
      cta: 'Confirm search',
      header: `Welcome, ${input.name.split(' ')[0]}!`,
      body: 'Confirm your roommate search below. It only takes a few seconds.',
      flowToken,
      screen: 'CONFIRM_SEARCH_SCREEN',
      initialData: { user_name: input.name },
    });

    return { phone: phoneE164, flowToken };
  }

  /**
   * Sends the match decision Flow presenting non-PII details of the candidate
   * and asking whether the user wants to proceed.
   */
  async triggerMatch(input: TriggerMatchInput) {
    if (!FLOW_MATCH_ID) {
      throw new HttpError(500, 'WHATSAPP_FLOW_MATCH_ID is not configured');
    }

    const phoneE164 = normalizePhoneToE164(input.userPhone);
    if (!phoneE164) {
      throw new HttpError(400, 'A valid Nigerian user phone number is required');
    }

    await this.ensureUser(phoneE164, input.userName);

    let candidateId = input.candidateId ?? null;
    if (candidateId) {
      const { data: candidate } = await supabase
        .from('users')
        .select('id')
        .eq('id', candidateId)
        .maybeSingle();
      if (!candidate) {
        throw new HttpError(404, 'Candidate user not found');
      }
    }

    const match = await this.upsertProposedMatch({
      matchId: input.matchId,
      userPhone: phoneE164,
      candidateId,
      compatibilityScore: input.compatibilityScore,
    });

    const summary = await this.buildCandidateSummary(candidateId, input);

    await whatsappService.sendFlowMessage({
      to: phoneE164,
      flowId: FLOW_MATCH_ID,
      cta: 'Review match',
      header: 'New roommate match!',
      body: `We found someone compatible with you (${input.compatibilityScore}% match). Review the details below.`,
      flowToken: match.flow_token!,
      screen: 'MATCH_DECISION_SCREEN',
      initialData: {
        candidate_summary: summary,
        compatibility_score: String(input.compatibilityScore),
      },
    });

    return { matchId: match.id, flowToken: match.flow_token! };
  }

  /**
   * Sends the 4-screen registration Flow inviting the user to build their
   * full roommate profile. Submissions land in roommate_profiles via
   * handleRegistrationResponse.
   */
  async triggerRegistration(input: { phone: string; name: string }) {
    const phoneE164 = normalizePhoneToE164(input.phone);
    if (!phoneE164) {
      throw new HttpError(400, 'A valid Nigerian phone number is required');
    }

    const flowToken = await this.sendRegistrationFlow(phoneE164, input.name);

    return { phone: phoneE164, flowToken };
  }

  /**
   * Automatically sends the registration invitation to a user who has messaged
   * the business number on WhatsApp (e.g. after tapping the wa.me link on the
   * website). Never sends more than once per window and never re-registers an
   * existing profile:
   *   - already_registered -> a roommate_profiles row exists
   *   - recently_sent      -> a registration invite was sent within
   *                           REGISTRATION_RESEND_WINDOW_MS
   *   - register           -> a fresh registration invite was sent
   *
   * Channel is controlled by WHATSAPP_REGISTRATION_CHANNEL:
   *   'flow'     -> interactive registration Flow (default)
   *   'template' -> approved message template (WHATSAPP_REGISTRATION_TEMPLATE_NAME),
   *                 no account/profile created and no URL sent
   */
  async autoSendRegistrationFlow(
    phoneE164: string,
    name?: string,
  ): Promise<'register' | 'already_registered' | 'recently_sent'> {
    if (!normalizePhoneToE164(phoneE164)) {
      console.warn('[whatsapp] autoSendRegistrationFlow ignored for invalid phone', { phoneE164 });
      return 'already_registered';
    }

    const existing = await this.findProfileByPhone(phoneE164);
    if (existing) return 'already_registered';

    const recentlySent = await this.registrationFlowSentRecently(phoneE164);
    if (recentlySent) return 'recently_sent';

    if (REGISTRATION_CHANNEL === 'template') {
      await this.sendRegistrationTemplate(phoneE164, name ?? 'Friend');
    } else {
      if (!FLOW_REGISTRATION_ID) {
        throw new HttpError(500, 'WHATSAPP_FLOW_REGISTRATION_ID is not configured');
      }
      await this.sendRegistrationFlow(phoneE164, name ?? 'Friend');
    }
    return 'register';
  }

  /**
   * Sends the registration invitation immediately, without the 15-minute
   * dedup guard. Used by the Sido bot when a user explicitly asks to
   * register. Channel is governed by WHATSAPP_REGISTRATION_CHANNEL.
   */
  async sendRegistrationInvite(phoneE164: string, name?: string): Promise<void> {
    if (REGISTRATION_CHANNEL === 'template') {
      await this.sendRegistrationTemplate(phoneE164, name ?? 'Friend');
    } else {
      if (!FLOW_REGISTRATION_ID) {
        throw new HttpError(500, 'WHATSAPP_FLOW_REGISTRATION_ID is not configured');
      }
      await this.sendRegistrationFlow(phoneE164, name ?? 'Friend');
    }
  }

  /** Sends the approved registration template (no URL, no account creation). */
  private async sendRegistrationTemplate(phoneE164: string, name: string) {
    const bodyParams =
      REGISTRATION_TEMPLATE_PARAMS > 0
        ? Array.from({ length: REGISTRATION_TEMPLATE_PARAMS }, () => name.split(' ')[0])
        : undefined;

    await whatsappService.sendTemplate({
      to: phoneE164,
      name: REGISTRATION_TEMPLATE_NAME,
      language: REGISTRATION_TEMPLATE_LANG,
      bodyParams,
    });
  }

  /** Sends the registration Flow message to an identified phone. */
  private async sendRegistrationFlow(phoneE164: string, name: string): Promise<string> {
    if (!FLOW_REGISTRATION_ID) {
      throw new HttpError(500, 'WHATSAPP_FLOW_REGISTRATION_ID is not configured');
    }

    await this.ensureUser(phoneE164, name);

    const flowToken = randomUUID();
    await whatsappService.sendFlowMessage({
      to: phoneE164,
      flowId: FLOW_REGISTRATION_ID,
      cta: 'Start registration',
      header: `Welcome, ${name.split(' ')[0]}!`,
      body: 'Let\u2019s set up your roommate profile. It only takes about 2 minutes.',
      flowToken,
      screen: 'PERSONAL_SCREEN',
      initialData: { user_name: name },
    });

    return flowToken;
  }

  // ---------------------------------------------------------------
  // Inbound webhook handlers
  // ---------------------------------------------------------------

  /**
   * Onboarding response (proceed_decision). YES activates the search; NO
   * opts the user out. Sends a text confirmation either way.
   */
  async handleOnboardingResponse(fromPhone: string, responseJson: Record<string, unknown>) {
    const phoneE164 = normalizePhoneToE164(fromPhone);
    const decision = String(responseJson.proceed_decision ?? '').toUpperCase();
    if (!phoneE164 || !['YES', 'NO'].includes(decision)) {
      console.warn('[whatsapp] ignored onboarding response', { fromPhone, decision });
      return { handled: false };
    }

    const accepted = decision === 'YES';
    const { error } = await supabase
      .from('users')
      .update({
        search_active: accepted,
        onboarding_status: accepted ? 'ACTIVE_SEARCH' : 'OPTED_OUT',
      })
      .eq('phone', phoneE164);

    if (error) {
      throw new HttpError(500, `Failed to update onboarding status: ${error.message}`);
    }

    await whatsappService.sendText(
      phoneE164,
      accepted
        ? 'Awesome! 🚀 Your search request is now ACTIVE. We will notify you right here on WhatsApp as soon as we find a compatible roommate.'
        : 'No problem! Your search remains on hold. You can reactivate it anytime by replying here.',
    );

    return { handled: true, decision };
  }

  /**
   * Registration form submission (flow: registration). Parses and validates
   * the 4-screen payload, then persists a row in roommate_profiles keyed by
   * the sender's phone number. Duplicate registrations are acknowledged and
   * skipped rather than double-inserted.
   */
  async handleRegistrationResponse(fromPhone: string, responseJson: Record<string, unknown>) {
    const phoneE164 = normalizePhoneToE164(fromPhone);
    if (!phoneE164) {
      console.warn('[whatsapp] registration ignored without a valid sender phone');
      return { handled: false };
    }

    const profile = this.parseRegistrationPayload(responseJson);
    if (!profile) {
      console.warn('[whatsapp] registration payload failed validation', { fromPhone });
      await whatsappService.sendText(
        phoneE164,
        '⚠️ Something went wrong with your registration. Please try again — if the problem persists, contact support.',
      );
      return { handled: false, invalid: true };
    }

    const existing = await this.findProfileByPhone(phoneE164);
    if (existing) {
      await whatsappService.sendText(
        phoneE164,
        '🎉 You already have a profile with Roommates NG — no need to register again. We\u2019ll notify you here on WhatsApp when we find a match.',
      );
      return { handled: true, duplicate: true };
    }

    const { error: insertError, data: created } = await supabase
      .from('roommate_profiles')
      .insert({ ...profile, phone_number: phoneE164 })
      .select('id')
      .single();

    if (insertError || !created) {
      throw new HttpError(500, `Failed to save registration profile: ${insertError?.message}`);
    }

    // Keep the WhatsApp identity row's email in sync with the submitted one.
    await supabase.from('users').update({ email: profile.email }).eq('phone', phoneE164);

    await whatsappService.sendText(
      phoneE164,
      `🎉 Registration complete, ${profile.full_name.split(' ')[0]}! We've received your details and will start matching you with a compatible roommate. We'll ping you right here on WhatsApp as soon as we find a match.`,
    );

    return { handled: true, profileId: created.id };
  }

  /**
   * Match decision (accept_match). YES marks the match ACCEPTED and returns a
   * CTA button with the ₦2,000 Paystack payment link. NO marks it REJECTED
   * with the saved decline reason.
   */
  async handleMatchDecision(flowToken: string, responseJson: Record<string, unknown>) {
    const match = await this.findMatchByFlowToken(flowToken);
    if (!match) {
      console.warn('[whatsapp] no match for flow token');
      return { handled: false };
    }

    const decision = String(responseJson.accept_match ?? '').toUpperCase();
    if (!['YES', 'NO'].includes(decision)) {
      console.warn('[whatsapp] unexpected accept_match value:', decision);
      return { handled: true, ignored: true };
    }

    if (match.status !== 'PROPOSED') {
      return { handled: true, duplicate: true };
    }

    if (decision === 'NO') {
      await this.rejectMatch(match, String(responseJson.decline_reason ?? ''));
      return { handled: true, outcome: 'REJECTED' };
    }

    await this.acceptMatchAndIssuePayment(match);
    return { handled: true, outcome: 'ACCEPTED' };
  }

  // ---------------------------------------------------------------
  // Post-payment fulfillment
  // ---------------------------------------------------------------

  /**
   * Sends the three post-unlock messages: candidate PII, safety disclaimer
   * and the re-match policy with the replacement form URL.
   */
  async fulfillUnlock(matchId: string) {
    const match = await this.fetchMatch(matchId);
    if (!match) {
      console.warn('[whatsapp] fulfillUnlock: match not found', matchId);
      return;
    }

    const candidatePii = await this.loadCandidatePii(match.candidate_id);

    if (candidatePii) {
      const piiLines = [
        "🎉 Payment confirmed — here are your roommate's contact details:",
        '',
        `👤 Name: ${candidatePii.fullName}`,
        `📱 Phone: ${candidatePii.phone}`,
        ...(candidatePii.socialHandle ? [`🔗 Social: ${candidatePii.socialHandle}`] : []),
      ];
      await whatsappService.sendText(match.user_phone, piiLines.join('\n'));
    } else {
      await whatsappService.sendText(
        match.user_phone,
        '🎉 Payment confirmed! Your match has been unlocked. Our team will share your roommate\u2019s contact details shortly.',
      );
    }

    await whatsappService.sendText(
      match.user_phone,
      [
        '🛡️ *Safety first — please follow these rules:*',
        '1. Always meet in a public place first.',
        '2. Inspect the apartment in person before paying any rent.',
        '3. Never transfer money to unverified individual accounts.',
        'Roommates NG never collects rent or deposits on behalf of anyone.',
      ].join('\n'),
    );

    await whatsappService.sendText(
      match.user_phone,
      [
        '🔁 *Re-match policy*',
        `If things do not work out, you can request a replacement match any time via ${REPLACEMENT_FORM_BASE_URL}?phone=${match.user_phone}`,
        '',
        'Please note: replacement matches are an optional courtesy capped at operational limits — they are not an absolute legal right.',
      ].join('\n'),
    );
  }

  // ---------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------

  /**
   * True when a registration invite (interactive Flow or the registration
   * template) was sent to the phone within REGISTRATION_RESEND_WINDOW_MS —
   * used to avoid re-sending the invitation on every inbound message.
   */
  private async registrationFlowSentRecently(phoneE164: string): Promise<boolean> {
    const windowStart = new Date(Date.now() - REGISTRATION_RESEND_WINDOW_MS).toISOString();

    const { data: interactive, error: interactiveError } = await supabase
      .from('whatsapp_messages')
      .select('created_at')
      .eq('phone', phoneE164)
      .eq('direction', 'outbound')
      .eq('message_type', 'interactive')
      .gte('created_at', windowStart)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (interactiveError) {
      console.error('[whatsapp] failed to check recent registration send:', interactiveError.message);
      return false;
    }
    if (interactive) return true;

    const { data: template, error: templateError } = await supabase
      .from('whatsapp_messages')
      .select('created_at')
      .eq('phone', phoneE164)
      .eq('direction', 'outbound')
      .eq('message_type', 'template')
      .contains('payload', { template: { name: REGISTRATION_TEMPLATE_NAME } })
      .gte('created_at', windowStart)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (templateError) {
      console.error('[whatsapp] failed to check recent registration send:', templateError.message);
      return false;
    }

    return Boolean(template);
  }

  /** Finds or creates the users row for a WhatsApp-led phone identity. */
  private async ensureUser(phoneE164: string, name?: string): Promise<UserRow> {
    const { data: existing, error: findError } = await supabase
      .from('users')
      .select('id, full_name, email, phone, whatsapp_number')
      .eq('phone', phoneE164)
      .maybeSingle();

    if (findError) {
      throw new HttpError(500, `Failed to look up user: ${findError.message}`);
    }

    if (existing) return existing as UserRow;

    const email = syntheticEmail(phoneE164);
    const password = randomUUID();

    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name ?? 'Roommate', phone: phoneE164, role: 'user' },
    });

    if (authError || !authUser?.user) {
      throw new HttpError(500, `Failed to provision user: ${authError?.message}`);
    }

    const { data: created, error: insertError } = await supabase
      .from('users')
      .insert({
        id: authUser.user.id,
        full_name: name ?? 'Roommate',
        email,
        whatsapp_number: phoneE164,
        phone: phoneE164,
        role: 'user',
        is_active: true,
      })
      .select('id, full_name, email, phone, whatsapp_number')
      .single();

    if (insertError || !created) {
      throw new HttpError(500, `Failed to create user record: ${insertError?.message}`);
    }

    return created as UserRow;
  }

  private async upsertProposedMatch(input: {
    matchId?: string;
    userPhone: string;
    candidateId: string | null;
    compatibilityScore: number;
  }): Promise<MatchRow> {
    if (input.matchId) {
      const existing = await this.fetchMatch(input.matchId);

      if (existing && existing.status !== 'PROPOSED') {
        throw new HttpError(
          409,
          `Match already progressed past proposal (status: ${existing.status})`,
        );
      }

      const flowToken = existing?.flow_token ?? randomUUID();
      const { data, error } = await supabase
        .from('matches')
        .upsert(
          {
            id: input.matchId,
            user_phone: input.userPhone,
            candidate_id: input.candidateId,
            compatibility_score: input.compatibilityScore,
            status: 'PROPOSED',
            flow_token: flowToken,
          },
          { onConflict: 'id' },
        )
        .select('*')
        .single();

      if (error || !data) {
        throw new HttpError(500, `Failed to store match: ${error?.message}`);
      }
      return data as MatchRow;
    }

    const { data, error } = await supabase
      .from('matches')
      .insert({
        user_phone: input.userPhone,
        candidate_id: input.candidateId,
        compatibility_score: input.compatibilityScore,
        status: 'PROPOSED',
        flow_token: randomUUID(),
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new HttpError(500, `Failed to create match: ${error?.message}`);
    }
    return data as MatchRow;
  }

  /**
   * Builds the sanitized, non-PII candidate summary shown in the decision
   * flow. Prefers the candidate's linked roommate profile when one exists,
   * falling back to the trigger payload's fields.
   */
  private async buildCandidateSummary(
    candidateId: string | null,
    fallback: TriggerMatchInput,
  ): Promise<string> {
    const lines: string[] = [];

    if (candidateId) {
      const { data: profile } = await supabase
        .from('roommate_profiles')
        .select(
          'age_range, occupation, preferred_locations, budget_min, budget_max, expected_move_in_date, allows_pets, sleep_habit',
        )
        .eq('user_id', candidateId)
        .maybeSingle();

      if (profile) {
        const p = profile as {
          age_range?: string | null;
          occupation?: string | null;
          preferred_locations?: string[] | null;
          budget_min?: number | null;
          budget_max?: number | null;
          expected_move_in_date?: string | null;
          allows_pets?: boolean | null;
          sleep_habit?: string | null;
        };
        if (p.age_range) lines.push(`**Age:** ${p.age_range}`);
        if (p.occupation) lines.push(`**Occupation:** ${p.occupation}`);
        if (p.preferred_locations?.length) lines.push(`**Areas:** ${p.preferred_locations.join(', ')}`);
        if (p.budget_min != null || p.budget_max != null) {
          lines.push(`**Budget:** ${naira(Number(p.budget_min ?? 0))} - ${naira(Number(p.budget_max ?? p.budget_min ?? 0))}`);
        }
        if (p.expected_move_in_date) lines.push(`**Move-in:** ${p.expected_move_in_date}`);
        if (typeof p.allows_pets === 'boolean') lines.push(`**Pets:** ${p.allows_pets ? 'Allowed' : 'Not allowed'}`);
        if (p.sleep_habit) lines.push(`**Sleep:** ${p.sleep_habit}`);
      }
    }

    if (lines.length === 0) {
      lines.push(`**Location:** ${fallback.location}`);
      lines.push(`**Budget:** ${naira(fallback.budget)}`);
      lines.push(`**Move-in:** ${fallback.moveInDate}`);
    }

    return lines.join('\n');
  }

  private async rejectMatch(match: MatchRow, declineReason: string) {
    const reason = (DECLINE_REASONS as readonly string[]).includes(declineReason)
      ? declineReason
      : 'OTHER';

    const { error } = await supabase
      .from('matches')
      .update({ status: 'REJECTED', rejection_reason: reason })
      .eq('id', match.id);

    if (error) {
      throw new HttpError(500, `Failed to reject match: ${error.message}`);
    }

    await whatsappService.sendText(
      match.user_phone,
      'Got it — we have recorded your preference and will keep looking for a better fit. Thanks for the feedback! 🙌',
    );
  }

  /**
   * Marks the match ACCEPTED, initializes a ₦2,000 Paystack transaction and
   * sends the payment link as an interactive CTA URL button.
   */
  private async acceptMatchAndIssuePayment(match: MatchRow) {
    const { error: acceptError } = await supabase
      .from('matches')
      .update({ status: 'ACCEPTED' })
      .eq('id', match.id)
      .eq('status', 'PROPOSED');

    if (acceptError) {
      throw new HttpError(500, `Failed to accept match: ${acceptError.message}`);
    }

    const user = await this.getUserByPhone(match.user_phone);
    const reference = randomUUID();

    const initialized = await paystackService.initializePayment({
      amountKobo: Math.round(MATCH_PAYMENT_AMOUNT_NGN * 100),
      email: user?.email ?? syntheticEmail(match.user_phone),
      reference,
      callbackUrl: PAYMENT_RETURN_URL,
      metadata: {
        match_id: match.id,
        user_phone: match.user_phone,
        purpose: 'roommate_unlock',
      },
    });

    const { error: txnError } = await supabase.from('transactions').insert({
      reference,
      user_phone: match.user_phone,
      match_id: match.id,
      amount: MATCH_PAYMENT_AMOUNT_NGN,
      status: 'PENDING',
    });

    if (txnError) {
      throw new HttpError(500, `Failed to record transaction: ${txnError.message}`);
    }

    await whatsappService.sendCtaUrlButton({
      to: match.user_phone,
      displayText: `Pay ${naira(MATCH_PAYMENT_AMOUNT_NGN)} now`,
      url: initialized.authorizationUrl,
      header: 'Unlock contact details 🔓',
      body:
        `Great choice! Tap below to pay the one-time ${naira(MATCH_PAYMENT_AMOUNT_NGN)} fee ` +
        "and unlock your roommate's full contact details.",
    });
  }

  private async loadCandidatePii(
    candidateId: string | null,
  ): Promise<{ fullName: string; phone: string; socialHandle: string | null } | null> {
    if (!candidateId) return null;

    const user = await supabase
      .from('users')
      .select('full_name, phone, whatsapp_number')
      .eq('id', candidateId)
      .maybeSingle();

    if (user.error || !user.data) return null;

    const u = user.data as { full_name: string; phone: string | null; whatsapp_number: string | null };

    const profile = await supabase
      .from('roommate_profiles')
      .select('social_handle')
      .eq('user_id', candidateId)
      .maybeSingle();

    return {
      fullName: u.full_name,
      phone: u.phone ?? u.whatsapp_number ?? '',
      socialHandle:
        ((profile.data as { social_handle?: string | null } | null)?.social_handle ?? null),
    };
  }

  private async findMatchByFlowToken(flowToken: string): Promise<MatchRow | null> {
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .eq('flow_token', flowToken)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Failed to resolve match: ${error.message}`);
    }
    return (data as MatchRow | null) ?? null;
  }

  private async fetchMatch(matchId: string): Promise<MatchRow | null> {
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Failed to fetch match: ${error.message}`);
    }
    return (data as MatchRow | null) ?? null;
  }

  private async getUserByPhone(phoneE164: string): Promise<UserRow | null> {
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, email, phone, whatsapp_number')
      .eq('phone', phoneE164)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Failed to load user: ${error.message}`);
    }
    return (data as UserRow | null) ?? null;
  }

  /**
   * Validates and normalizes the registration form payload into the exact
   * column mapping used by roommate_profiles. Returns null when any required
   * field is missing or invalid (the user is told to retry).
   */
  private parseRegistrationPayload(
    responseJson: Record<string, unknown>,
  ): {
    full_name: string;
    email: string;
    gender: string;
    age_range: string;
    marital_status: string;
    religion: string;
    state: string;
    preferred_locations: string[];
    budget_min: number;
    budget_max: number;
    expected_move_in_date: string;
    occupation: string;
    smoking_habit: string;
    allows_pets: boolean;
    personal_bio: string | null;
    agreed_to_terms: boolean;
    agreed_at: string;
    status: string;
    is_active: boolean;
  } | null {
    const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

    const first_name = str(responseJson.first_name);
    const last_name = str(responseJson.last_name);
    const email = str(responseJson.email).toLowerCase();
    const gender = str(responseJson.gender);
    const age_range = str(responseJson.age_range);
    const marital_status = str(responseJson.marital_status);
    const religion = str(responseJson.religion);
    const state = str(responseJson.state);
    const location = str(responseJson.location);
    const occupation = str(responseJson.occupation);
    const smoking_habit = str(responseJson.smoking_habit);

    if (!first_name || !last_name) return null;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    if (!(REGISTRATION_GENDERS as readonly string[]).includes(gender)) return null;
    if (!age_range) return null;
    if (!(REGISTRATION_MARITAL_STATUS as readonly string[]).includes(marital_status)) return null;
    if (!(REGISTRATION_RELIGIONS as readonly string[]).includes(religion)) return null;
    if (state !== 'Lagos') return null;
    if (!location) return null;
    if (!(REGISTRATION_OCCUPATIONS as readonly string[]).includes(occupation)) return null;
    if (!(REGISTRATION_SMOKING_HABITS as readonly string[]).includes(smoking_habit)) return null;

    const budgetMin = this.normalizeBudgetValue(responseJson.budget_min);
    const budgetMax = this.normalizeBudgetValue(responseJson.budget_max);
    if (budgetMin === null || budgetMax === null || budgetMax < budgetMin) return null;

    const expectedMoveInDate = this.normalizeDate(responseJson.expected_move_in_date);
    if (!expectedMoveInDate) return null;

    if (!this.agreedToTerms(responseJson.agreed_to_terms)) return null;

    const allowsPets = String(responseJson.allows_pets).toUpperCase() === 'YES';
    const personalBio = str(responseJson.personal_bio) || null;

    return {
      full_name: `${first_name} ${last_name}`,
      email,
      gender,
      age_range,
      marital_status,
      religion,
      state,
      preferred_locations: [location],
      budget_min: budgetMin,
      budget_max: budgetMax,
      expected_move_in_date: expectedMoveInDate,
      occupation,
      smoking_habit,
      allows_pets: allowsPets,
      personal_bio: personalBio,
      agreed_to_terms: true,
      agreed_at: new Date().toISOString(),
      status: 'new',
      is_active: true,
    };
  }

  private normalizeBudgetValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;

    if (typeof value === 'string') {
      if (value === '2000000_plus') return 2000000;
      const cleaned = value.replace(/[^\d.-]/g, '');
      if (!cleaned) return null;
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  /** Accepts YYYY-MM-DD or DD/MM/YYYY style dates (Meta picker format varies by device locale). */
  private normalizeDate(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const s = value.trim();

    const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (iso) {
      return this.padDate(iso[1], iso[2], iso[3]);
    }

    const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (dmy) {
      const first = Number(dmy[1]);
      const second = Number(dmy[2]);
      const year = dmy[3];
      if (first > 12) return this.padDate(year, dmy[2], dmy[1]);
      if (second > 12) return this.padDate(year, dmy[1], dmy[2]);
      return this.padDate(year, dmy[2], dmy[1]);
    }

    const parsed = new Date(s);
    if (Number.isNaN(parsed.getTime())) return null;
    return this.padDate(
      String(parsed.getFullYear()),
      String(parsed.getMonth() + 1),
      String(parsed.getDate()),
    );
  }

  private padDate(year: string, month: string, day: string): string {
    const mm = month.padStart(2, '0');
    const dd = day.padStart(2, '0');
    const formatted = `${year}-${mm}-${dd}`;
    const d = new Date(formatted);
    if (Number.isNaN(d.getTime())) return '';
    return formatted;
  }

  private agreedToTerms(value: unknown): boolean {
    if (Array.isArray(value)) return value.includes('AGREE');
    return String(value) === 'AGREE' || String(value) === 'true';
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

export const whatsappLifecycleService = new WhatsAppLifecycleService();
