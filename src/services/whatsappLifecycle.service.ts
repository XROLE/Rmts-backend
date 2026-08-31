import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { HttpError } from '../middleware/errorHandler.js';
import { supabase } from '../config/supabase.js';
import { whatsappService } from './whatsapp.service.js';
import { paystackService } from './paystack.service.js';
import { normalizePhoneToE164, normalizeAnyPhoneToE164 } from '../utils/normalizePhone.js';

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

/** Template sent to a freshly created profile's WhatsApp contact to confirm. */
const WELCOME_TEMPLATE_NAME =
  process.env.WHATSAPP_WELCOME_TEMPLATE_NAME ?? 'welcome_to_roommate_ng';
const WELCOME_TEMPLATE_LANG = process.env.WHATSAPP_WELCOME_TEMPLATE_LANG ?? 'en_US';
const WELCOME_TEMPLATE_ENABLED = process.env.WHATSAPP_WELCOME_TEMPLATE_ENABLED !== 'false';
/** Button payloads that echo back in the inbound webhook for the template. */
const WELCOME_CONFIRM_PAYLOAD = 'confirm_request';
const WELCOME_DECLINE_PAYLOAD = 'decline_request';

/** Template sent to both matched roommates when an admin confirms a match. */
const MATCH_TEMPLATE_NAME = process.env.WHATSAPP_MATCH_TEMPLATE_NAME ?? 'new_match_alert';
const MATCH_TEMPLATE_LANG = process.env.WHATSAPP_MATCH_TEMPLATE_LANG ?? 'en';
const MATCH_TEMPLATE_ENABLED = process.env.WHATSAPP_MATCH_TEMPLATE_ENABLED !== 'false';
/** Quick-reply payloads echoed back on the match template buttons. */
export const MATCH_CONNECT_PAYLOAD = 'connect_request';
export const MATCH_DECLINE_PAYLOAD = 'decline_request';

const MATCH_NO_BIO_FALLBACK =
  'User did not upload bio at this point, you can speak more with the user to find out the kind of person he is before agreeing to live together';

/** Time-bound match fee links (defaults: expires 23h, nudge 6h before). */
const MATCH_PAYMENT_LINK_EXPIRY_HOURS = Number(
  process.env.MATCH_PAYMENT_LINK_EXPIRY_HOURS ?? 23,
);
const MATCH_PAYMENT_NUDGE_BEFORE_HOURS = Number(
  process.env.MATCH_PAYMENT_NUDGE_BEFORE_HOURS ?? 6,
);
const MATCH_PAYMENT_LINK_EXPIRY_MS = MATCH_PAYMENT_LINK_EXPIRY_HOURS * 60 * 60 * 1000;
const MATCH_PAYMENT_NUDGE_BEFORE_MS = MATCH_PAYMENT_NUDGE_BEFORE_HOURS * 60 * 60 * 1000;
const COMMISSION_PERCENT = Number(process.env.COMMISSION_PERCENT ?? 10);

const MATCH_FEE_PITCH_TEXT =
  'This is a one-time service charge for the matching service.\n\n' +
  'Your fee covers:\n' +
  '• Up to seven (7) different matches\n' +
  '• 24hr personal AI-assisted support on WhatsApp\n' +
  '• Security tips on how to spot a fishy roommate and stay safe throughout your roommate search journey\n\n' +
  `Please note: the fee is non-refundable. Your payment link is valid for ${MATCH_PAYMENT_LINK_EXPIRY_HOURS} hours; if it is not paid within that time, this match will be canceled. You will be connected with your matched roommate once the service fee is paid.`;

export interface MatchParticipantRow {
  id: string;
  match_id: string;
  profile_id: string;
  phone: string;
  response: 'pending' | 'accepted' | 'declined';
  payment_reference: string | null;
  payment_status: 'pending' | 'paid';
  paid_at: string | null;
}

interface DueMatchParticipantRow {
  id: string;
  match_id: string;
  profile_id: string;
  phone: string;
  payment_status: string;
  payment_link_created_at: string | null;
  nudge_sent_at: string | null;
  expired_at: string | null;
}

/** Profile fields used to build the new_match_alert params for the other side. */
export interface MatchedProfileInput {
  id: string;
  full_name: string;
  phone_number: string;
  gender?: string | null;
  age_range?: string | null;
  state?: string | null;
  religion?: string | null;
  preferred_locations?: string[] | null;
  budget_min?: number | null;
  budget_max?: number | null;
  occupation?: string | null;
  smoking_habit?: string | null;
  personal_bio?: string | null;
}

/** Subset of a roommate_profiles row needed to address the welcome template. */
export interface WelcomeProfileInput {
  id: string;
  full_name: string;
  phone_number: string;
  state: string;
  preferred_locations?: string[];
  budget_min?: number | null;
  budget_max?: number | null;
}

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

  /**
   * Sends the welcome_to_roommate_ng confirmation template to a freshly
   * created profile's WhatsApp contact with its two quick-reply buttons.
   *
   * Param mapping:
   *   {{1}} = user's first name
   *   {{2}} = user's selected area (preferred_locations[0])
   *   {{3}} = user's state
   *   {{4}} = budget range in thousands ("300 - 500", single value when equal)
   *
   * Only fires when WHATSAPP_WELCOME_TEMPLATE_ENABLED. Returns false and logs
   * when the profile can't be addressed (missing/invalid phone or place).
   */
  async sendWelcomeTemplate(input: WelcomeProfileInput): Promise<boolean> {
    if (!WELCOME_TEMPLATE_ENABLED) return false;

    const phoneE164 = normalizePhoneToE164(input.phone_number);
    if (!phoneE164) {
      console.warn('[whatsapp] welcome template skipped: invalid phone', input.phone_number);
      return false;
    }

    const location = input.preferred_locations?.[0];
    if (!location || !input.state) {
      console.warn('[whatsapp] welcome template skipped: missing location/state', input.phone_number);
      return false;
    }

    const firstName = input.full_name.trim().split(/\s+/)[0] || 'there';

    await whatsappService.sendTemplate({
      to: phoneE164,
      name: WELCOME_TEMPLATE_NAME,
      language: WELCOME_TEMPLATE_LANG,
      bodyParams: [
        firstName,
        location,
        input.state,
        this.budgetRangeLabel(Number(input.budget_min ?? 0), Number(input.budget_max ?? 0)),
      ],
      buttonPayloads: [WELCOME_CONFIRM_PAYLOAD, WELCOME_DECLINE_PAYLOAD],
    });

    const { error } = await supabase
      .from('roommate_profiles')
      .update({ welcome_sent_at: new Date().toISOString() })
      .eq('id', input.id);

    if (error) {
      console.error('[whatsapp] failed to record welcome_sent_at:', error.message);
    }

    return true;
  }

  /**
   * Handles a quick-reply button press on the welcome template.
   *   confirm_request -> profile stays active and enters the matching queue
   *   decline_request -> profile is marked inactive so it is never matched
   * Both updates are idempotent — repeats are acknowledged without re-writing.
   */
  async handleWelcomeButtonReply(
    fromPhone: string,
    buttonText: string,
    payload: string,
  ): Promise<{
    handled: boolean;
    outcome?: 'confirmed' | 'declined' | 'already_confirmed' | 'already_declined';
  }> {
    const phoneE164 = normalizePhoneToE164(fromPhone) ?? normalizeAnyPhoneToE164(fromPhone);
    if (!phoneE164) return { handled: false };

    const profile = await this.findProfileByAnyPhone(phoneE164);
    if (!profile) {
      console.warn('[whatsapp] welcome button replied but no profile found', { fromPhone, buttonText });
      return { handled: false };
    }

    const now = new Date().toISOString();

    if (payload === WELCOME_CONFIRM_PAYLOAD) {
      if (profile.welcome_declined_at) return { handled: true, outcome: 'already_declined' };
      if (profile.welcome_confirmed_at) return { handled: true, outcome: 'already_confirmed' };

      const { error } = await supabase
        .from('roommate_profiles')
        .update({ welcome_confirmed_at: now, is_active: true })
        .eq('id', profile.id);

      if (error) {
        console.error('[whatsapp] failed to confirm profile:', error.message);
      }
      return { handled: true, outcome: 'confirmed' };
    }

    if (payload === WELCOME_DECLINE_PAYLOAD) {
      if (profile.welcome_declined_at) return { handled: true, outcome: 'already_declined' };

      const { error } = await supabase
        .from('roommate_profiles')
        .update({ welcome_declined_at: now, is_active: false })
        .eq('id', profile.id);

      if (error) {
        console.error('[whatsapp] failed to decline profile:', error.message);
      }
      return { handled: true, outcome: 'declined' };
    }

    console.warn('[whatsapp] unrecognized welcome button payload:', payload);
    return { handled: true };
  }

  private budgetRangeLabel(min: number, max: number): string {
    const kMin = Math.round(min / 1000);
    const kMax = Math.round(max / 1000);
    // NaN/zero protection: fall back to a plain thousands label.
    const lo = Number.isFinite(kMin) ? kMin : 0;
    const hi = Number.isFinite(kMax) && kMax > lo ? kMax : lo;
    return hi > lo ? `${lo} - ${hi}` : `${lo}`;
  }

  /**
   * Finds a profile by any serialization of its phone number
   * (+234..., 234..., 0...</national forms) since the web form accepts a
   * few different formats while WhatsApp always forwards +234... .
   */
  private async findProfileByAnyPhone(
    phoneE164: string,
  ): Promise<{
    id: string;
    welcome_confirmed_at: string | null;
    welcome_declined_at: string | null;
  } | null> {
    const digits = phoneE164.replace(/\D/g, '');
    const national = digits.startsWith('234') ? digits.slice(3) : digits;
    const variants = [phoneE164, digits, `0${national}`, national];

    const { data, error } = await supabase
      .from('roommate_profiles')
      .select('id, welcome_confirmed_at, welcome_declined_at')
      .in('phone_number', variants)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[whatsapp] failed to find profile by phone:', error.message);
      return null;
    }

    return (data as { id: string; welcome_confirmed_at: string | null; welcome_declined_at: string | null } | null) ?? null;
  }

  // ---------------------------------------------------------------
  // Admin-confirmed match confirmation + service fee flow
  // ---------------------------------------------------------------

  /**
   * Starts the two-user match confirmation flow: records one participant row
   * per matched profile and sends the new_match_alert template to both
   * WhatsApp contacts. Each template is built from the OTHER profile's
   * details with the Connect / Decline quick-reply buttons. Fire-and-forget
   * from the confirming endpoint; failures never roll back a confirmed match.
   */
  async startMatchConfirmation(input: {
    matchId: string;
    profiles: MatchedProfileInput[];
  }): Promise<void> {
    if (!MATCH_TEMPLATE_ENABLED) return;

    const [profileA, profileB] = input.profiles;
    if (!profileA || !profileB) {
      console.warn('[whatsapp] match confirmation skipped: both profiles required');
      return;
    }

    for (const recipient of [profileA, profileB]) {
      const target = recipient.id === profileA.id ? profileB : profileA;
      try {
        const phoneE164 = normalizePhoneToE164(recipient.phone_number);
        if (!phoneE164) {
          console.warn('[whatsapp] match confirmation skipped: invalid phone', recipient.phone_number);
          continue;
        }

        await supabase
          .from('match_participants')
          .upsert(
            {
              match_id: input.matchId,
              profile_id: recipient.id,
              phone: phoneE164,
              response: 'pending',
              payment_status: 'pending',
            },
            { onConflict: 'match_id,profile_id' },
          );

        await whatsappService.sendTemplate({
          to: phoneE164,
          name: MATCH_TEMPLATE_NAME,
          language: MATCH_TEMPLATE_LANG,
          bodyParams: this.buildMatchAlertParams(recipient, target),
          buttonPayloads: [MATCH_CONNECT_PAYLOAD, MATCH_DECLINE_PAYLOAD],
        });
      } catch (err) {
        console.error('[whatsapp] failed to start match confirmation for a profile:', err);
      }
    }
  }

  /** Builds the ten new_match_alert body params for the receiving user. */
  private buildMatchAlertParams(
    recipient: MatchedProfileInput,
    target: MatchedProfileInput,
  ): string[] {
    return [
      recipient.full_name?.trim().split(/\s+/)[0] || 'there',
      target.preferred_locations?.[0] || '',
      target.state || '',
      this.matchBudgetLabel(Number(target.budget_min ?? 0), Number(target.budget_max ?? 0)),
      this.humanizeLabel(target.gender),
      target.age_range || '',
      this.humanizeLabel(target.occupation),
      target.religion || '',
      this.humanizeLabel(target.smoking_habit),
      target.personal_bio?.trim() || MATCH_NO_BIO_FALLBACK,
    ];
  }

  /** Formats a naira budget as "50k - 150k / year" (single value when equal). */
  private matchBudgetLabel(min: number, max: number): string {
    const kMin = Math.round(min / 1000);
    const kMax = Math.round(max / 1000);
    const lo = Number.isFinite(kMin) ? kMin : 0;
    const hi = Number.isFinite(kMax) ? kMax : lo;
    return hi > lo ? `${lo}k - ${hi}k / year` : `${lo}k / year`;
  }

  /** Humanizes stored enum codes (male -> Male, working_professional -> Working professional). */
  private humanizeLabel(value?: string | null): string {
    if (!value) return '';
    const map: Record<string, string> = {
      male: 'Male',
      female: 'Female',
      no_preference: 'No preference',
      student: 'Student',
      nysc: 'NYSC',
      working_professional: 'Working professional',
      self_employed: 'Self employed',
      job_seeker: 'Job seeker',
      non_smoker: 'Non-smoker',
      occasional_smoker: 'Occasional smoker',
      regular_smoker: 'Regular smoker',
    };
    return map[value] ?? value.charAt(0).toUpperCase() + value.slice(1);
  }

  /**
   * Handles a quick-reply button press on the new_match_alert template.
   *  - connect_request: mark accepted. If the other side also accepted, both
   *    get the good-news message and an individual service fee payment link.
   *    Otherwise the connector is told we are waiting on the other side.
   *  - decline_request: mark declined (+ notify/close/release via
   *    handleMatchDeclined).
   */
  async handleMatchButtonReply(
    fromPhone: string,
    buttonText: string,
    payload: string,
  ): Promise<{
    handled: boolean;
    outcome?: 'connected' | 'both_connected' | 'already_connected' | 'declined';
  }> {
    const phoneE164 = normalizePhoneToE164(fromPhone) ?? normalizeAnyPhoneToE164(fromPhone);
    if (!phoneE164) return { handled: false };

    const participant = await this.findParticipantByPhone(phoneE164);
    if (!participant) {
      console.warn('[whatsapp] match button replied but no participant found', {
        fromPhone,
        buttonText,
      });
      return { handled: false };
    }

    if (payload === MATCH_CONNECT_PAYLOAD) {
      if (participant.response === 'declined') return { handled: true, outcome: 'declined' };
      if (participant.response === 'accepted') return { handled: true, outcome: 'already_connected' };

      await supabase
        .from('match_participants')
        .update({ response: 'accepted' })
        .eq('id', participant.id);

      const sibling = await this.fetchSiblingParticipant(
        participant.match_id,
        participant.profile_id,
      );

      if (sibling?.response === 'accepted') {
        await this.celebrateBothAccepted(participant.match_id);
        return { handled: true, outcome: 'both_connected' };
      }

      await whatsappService.sendText(
        participant.phone,
        'We have acknowledged your matching request and we are waiting for the other potential match to respond. Once they accept to connect, we will swing into action! 👍',
      );
      return { handled: true, outcome: 'connected' };
    }

    if (payload === MATCH_DECLINE_PAYLOAD) {
      if (participant.response !== 'declined') {
        await supabase
          .from('match_participants')
          .update({ response: 'declined' })
          .eq('id', participant.id);
      }
      await this.handleMatchDeclined(participant);
      return { handled: true, outcome: 'declined' };
    }

    return { handled: false };
  }

  /** Both accepted: good news to each, then issue each their fee payment link. */
  private async celebrateBothAccepted(matchId: string): Promise<void> {
    const { data, error } = await supabase
      .from('match_participants')
      .select('*')
      .eq('match_id', matchId)
      .eq('response', 'accepted');

    if (error) {
      console.error('[whatsapp] failed to fetch accepted participants:', error.message);
      return;
    }

    for (const participant of (data ?? []) as MatchParticipantRow[]) {
      if (participant.payment_reference) continue;
      await whatsappService.sendText(
        participant.phone,
        '🎉 Great news! You and your potential match have both accepted to be connected. Each of you will now get a payment link to activate the match — once the service fee is paid, we will swing into action!',
      );
      await this.issueMatchFeeLink(participant.phone, participant);
    }
  }

  /**
   * Decline handling: notify the decliner; if the sibling had accepted and
   * nobody has paid, also notify the sibling, close the match and release both
   * profiles back to 'new' so they can be re-matched.
   */
  private async handleMatchDeclined(participant: MatchParticipantRow): Promise<void> {
    await whatsappService.sendText(
      participant.phone,
      "We have noted your decision — no wahala. Your profile stays open in the pool, so we can still match you with someone else. 👍",
    );

    const sibling = await this.fetchSiblingParticipant(participant.match_id, participant.profile_id);
    const canRelease = !sibling || sibling.payment_status !== 'paid';

    if (canRelease) {
      if (sibling?.response === 'accepted') {
        await whatsappService.sendText(
          sibling.phone,
          'Just to let you know — the potential match declined this time. No stress: your profile is back in the pool and we’ll keep looking for a better fit for you.',
        );
      }

      await supabase
        .from('roommate_matches')
        .update({ status: 'closed' })
        .eq('id', participant.match_id);

      const { data: participants } = await supabase
        .from('match_participants')
        .select('profile_id')
        .eq('match_id', participant.match_id);

      const profileIds = (participants ?? []).map((p) => p.profile_id as string);
      if (profileIds.length) {
        await supabase
          .from('roommate_profiles')
          .update({ status: 'new' })
          .in('id', profileIds)
          .eq('status', 'matched');
      }
    }
  }

  private async findParticipantByPhone(phoneE164: string): Promise<MatchParticipantRow | null> {
    const { data, error } = await supabase
      .from('match_participants')
      .select('*')
      .eq('phone', phoneE164)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[whatsapp] failed to find participant by phone:', error.message);
      return null;
    }
    return (data as MatchParticipantRow | null) ?? null;
  }

  private async fetchSiblingParticipant(
    matchId: string,
    profileId: string,
  ): Promise<MatchParticipantRow | null> {
    const { data, error } = await supabase
      .from('match_participants')
      .select('*')
      .eq('match_id', matchId)
      .neq('profile_id', profileId)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[whatsapp] failed to fetch sibling participant:', error.message);
      return null;
    }
    return (data as MatchParticipantRow | null) ?? null;
  }

  /**
   * Issues the one-time service fee payment link for a participant who
   * confirmed their match. Initializes a Paystack transaction, records it in
   * transactions (participant_id), attaches the reference to the participant,
   * then sends the fee pitch plus the Paystack button.
   */
  async issueMatchFeeLink(phoneE164: string, participant: MatchParticipantRow): Promise<void> {
    if (participant.payment_reference) {
      console.log('[whatsapp] fee link already issued for participant', participant.id);
      return;
    }

    const { data: profile } = await supabase
      .from('roommate_profiles')
      .select('id, full_name, email, referred_by_code')
      .eq('id', participant.profile_id)
      .single();

    const name = profile?.full_name ?? 'there';
    const email = profile?.email ?? syntheticEmail(phoneE164);

    // Guarantee the users(phone) FK that transactions.user_phone references.
    await this.ensureUser(phoneE164, name);

    const matchedRoommateProfileId = await this.fetchSiblingProfileId(
      participant.match_id,
      participant.profile_id,
    );

    const reference = randomUUID();
    const initialized = await paystackService.initializePayment({
      amountKobo: Math.round(MATCH_PAYMENT_AMOUNT_NGN * 100),
      email,
      reference,
      callbackUrl: PAYMENT_RETURN_URL,
      metadata: {
        match_id: participant.match_id,
        profile_id: participant.profile_id,
        participant_id: participant.id,
        matched_roommate_profile_id: matchedRoommateProfileId,
        purpose: 'roommate_match_fee',
      },
    });

    const { error: txnError } = await supabase.from('transactions').insert({
      reference,
      user_phone: phoneE164,
      participant_id: participant.id,
      amount: MATCH_PAYMENT_AMOUNT_NGN,
      status: 'PENDING',
    });
    if (txnError) {
      throw new HttpError(500, `Failed to record match fee transaction: ${txnError.message}`);
    }

    const { error: partError } = await supabase
      .from('match_participants')
      .update({
        payment_reference: reference,
        payment_link_created_at: new Date().toISOString(),
      })
      .eq('id', participant.id);
    if (partError) {
      console.error('[whatsapp] failed to attach reference to participant:', partError.message);
    }

    // Credit the referring ambassador (if this roommate was referred). Best
    // effort — a commission hiccup must never block the payment link message.
    try {
      await this.attachCommissionIfReferred({
        profileId: participant.profile_id,
        referralCode: profile?.referred_by_code ?? null,
        matchId: participant.match_id,
        matchedRoommateProfileId,
        amountNg: MATCH_PAYMENT_AMOUNT_NGN,
        reference,
        accessCode: initialized.accessCode,
        authorizationUrl: initialized.authorizationUrl,
      });
    } catch (err) {
      console.error('[whatsapp] failed to attach commission:', err);
    }

    await whatsappService.sendText(phoneE164, MATCH_FEE_PITCH_TEXT);
    await whatsappService.sendCtaUrlButton({
      to: phoneE164,
      displayText: `Pay ${naira(MATCH_PAYMENT_AMOUNT_NGN)} now`,
      url: initialized.authorizationUrl,
      header: 'Pay service fee 🏠',
      body: 'Tap below to pay the one-time service charge and get connected with your matched roommate.',
    });
  }

  /**
   * Fulfills one paid side of an admin-confirmed match: connects the payer
   * with the matched roommate's contact details plus the standard safety and
   * re-match policy messages.
   */
  async fulfillPairParticipant(participantId: string): Promise<void> {
    const participant = await this.fetchParticipant(participantId);
    if (!participant) {
      console.warn('[whatsapp] fulfillPairParticipant: participant not found', participantId);
      return;
    }

    const { data: sibling } = await supabase
      .from('match_participants')
      .select('profile_id')
      .eq('match_id', participant.match_id)
      .neq('profile_id', participant.profile_id)
      .limit(1)
      .maybeSingle();

    const mate = sibling?.profile_id
      ? await this.fetchProfileContacts(sibling.profile_id)
      : null;

    if (mate) {
      await whatsappService.sendText(
        participant.phone,
        [
          '🎉 Payment confirmed — you are now connected with your matched roommate!',
          '',
          `👤 Name: ${mate.full_name}`,
          `📱 Phone: ${mate.phone}`,
          ...(mate.social_handle ? [`🔗 Social: ${mate.social_handle}`] : []),
        ].join('\n'),
      );
    } else {
      await whatsappService.sendText(
        participant.phone,
        '🎉 Payment confirmed! You are connected. Our team will share your matched roommate\u2019s contact details shortly.',
      );
    }

    await whatsappService.sendText(
      participant.phone,
      [
        "🛡️ *Sido's safety squad — quick wins before you guys link up:*",
        "1. Do a video call first — a roommate who refuses camera calls is a big red flag 🚩",
        "2. Inspect the apartment in daylight and bring a friend along.",
        "3. Sign a roommate/sublet agreement before paying any holding deposit.",
        "4. Never pay via wire transfer, gift cards, or untraceable channels.",
        "5. A price way below the market rate is usually a phantom listing — be careful.",
        '',
        'Roommates NG never collects rent, deposits or inspection fees on behalf of anyone.',
      ].join('\n'),
    );

    await whatsappService.sendText(
      participant.phone,
      [
        '🔁 *Re-match policy*',
        `If things do not work out, you can request a replacement match any time via ${REPLACEMENT_FORM_BASE_URL}?phone=${participant.phone}`,
        '',
        'Please note: replacement matches are an optional courtesy capped at operational limits — they are not an absolute legal right.',
      ].join('\n'),
    );
  }

  private async fetchParticipant(id: string): Promise<MatchParticipantRow | null> {
    const { data, error } = await supabase
      .from('match_participants')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      console.error('[whatsapp] failed to fetch participant:', error.message);
      return null;
    }
    return (data as MatchParticipantRow | null) ?? null;
  }

  private async fetchProfileContacts(
    profileId: string,
  ): Promise<{ full_name: string; phone: string; social_handle: string | null } | null> {
    const { data, error } = await supabase
      .from('roommate_profiles')
      .select('full_name, phone_number, social_handle')
      .eq('id', profileId)
      .maybeSingle();
    if (error || !data) return null;
    const p = data as { full_name: string; phone_number: string; social_handle: string | null };
    return { full_name: p.full_name, phone: p.phone_number, social_handle: p.social_handle ?? null };
  }

  // ---------------------------------------------------------------
  // Ambassador commission + time-bound fee link sweep
  // ---------------------------------------------------------------

  private async fetchSiblingProfileId(matchId: string, profileId: string): Promise<string | null> {
    const { data } = await supabase
      .from('match_participants')
      .select('profile_id')
      .eq('match_id', matchId)
      .neq('profile_id', profileId)
      .limit(1)
      .maybeSingle();
    return data?.profile_id ?? null;
  }

  /**
   * Records the ambassador commission for a referred roommate's service fee
   * payment. Mirrors paymentService.createPaymentLink: payment_links +
   * commission_earnings (pending) + pending_balance bump. Best-effort.
   */
  private async attachCommissionIfReferred(input: {
    profileId: string;
    referralCode: string | null;
    matchId: string;
    matchedRoommateProfileId: string | null;
    amountNg: number;
    reference: string;
    accessCode: string | null;
    authorizationUrl: string;
  }): Promise<void> {
    if (!input.referralCode) return;

    const referralCode = input.referralCode.toUpperCase();
    const { data: ambassador, error: ambError } = await supabase
      .from('ambassador_profiles')
      .select('id, user_id, pending_balance_ngn')
      .eq('referral_code', referralCode)
      .maybeSingle();

    if (ambError || !ambassador) {
      console.warn('[whatsapp] commission skipped: no ambassador for referral code', referralCode);
      return;
    }

    const commission = Number(((input.amountNg * COMMISSION_PERCENT) / 100).toFixed(2));

    const { data: paymentLink, error: linkError } = await supabase
      .from('payment_links')
      .insert({
        roommate_profile_id: input.profileId,
        ambassador_user_id: ambassador.user_id,
        referral_code: referralCode,
        amount_ngn: input.amountNg,
        paystack_reference: input.reference,
        paystack_access_code: input.accessCode,
        paystack_authorization_url: input.authorizationUrl,
        match_id: input.matchId,
        matched_roommate_profile_id: input.matchedRoommateProfileId,
        status: 'pending',
      })
      .select('id')
      .single();

    if (linkError || !paymentLink) {
      console.error('[whatsapp] failed to store payment link for commission:', linkError?.message);
      return;
    }

    const { error: commissionError } = await supabase.from('commission_earnings').insert({
      ambassador_user_id: ambassador.user_id,
      roommate_profile_id: input.profileId,
      payment_link_id: paymentLink.id,
      amount_ngn: commission,
      referral_code: referralCode,
      status: 'pending',
      paystack_reference: input.reference,
    });
    if (commissionError) {
      console.error('[whatsapp] failed to record commission:', commissionError.message);
    }

    const { error: balanceError } = await supabase
      .from('ambassador_profiles')
      .update({ pending_balance_ngn: ambassador.pending_balance_ngn + commission })
      .eq('id', ambassador.id);
    if (balanceError) {
      console.error('[whatsapp] failed to bump ambassador pending balance:', balanceError.message);
    }
  }

  /**
   * Scheduled sweep for time-bound match fee links (started in server.ts).
   *   - nudges participants whose link expires soon
   *   - expires unpaid links and cancels the match
   */
  async processDueMatchPayments(): Promise<{ nudged: number; expired: number }> {
    const now = Date.now();

    const { data, error } = await supabase
      .from('match_participants')
      .select(
        'id, match_id, profile_id, phone, payment_status, payment_link_created_at, nudge_sent_at, expired_at',
      )
      .eq('payment_status', 'pending')
      .not('payment_reference', 'is', null)
      .is('expired_at', null);

    if (error) {
      console.error('[scheduler] failed to fetch due payment links:', error.message);
      return { nudged: 0, expired: 0 };
    }

    let nudged = 0;
    let expired = 0;

    for (const row of (data ?? []) as DueMatchParticipantRow[]) {
      if (!row.payment_link_created_at) continue;
      const issuedAt = new Date(row.payment_link_created_at).getTime();
      const expiryAt = issuedAt + MATCH_PAYMENT_LINK_EXPIRY_MS;
      const nudgeAt = expiryAt - MATCH_PAYMENT_NUDGE_BEFORE_MS;

      if (now >= expiryAt) {
        await this.expireMatchParticipant(row);
        expired += 1;
      } else if (now >= nudgeAt && !row.nudge_sent_at) {
        await this.sendExpiryNudge(row);
        nudged += 1;
      }
    }

    return { nudged, expired };
  }

  /** Marks an unpaid participant's link expired and cancels the match. */
  private async expireMatchParticipant(row: DueMatchParticipantRow): Promise<void> {
    const now = new Date().toISOString();

    await supabase
      .from('match_participants')
      .update({ expired_at: now, response: 'declined' })
      .eq('id', row.id);

    const { data: siblings } = await supabase
      .from('match_participants')
      .select('id, profile_id, phone, payment_status')
      .eq('match_id', row.match_id);

    const siblingsList = (siblings ?? []) as Array<{
      profile_id: string;
      phone: string;
      payment_status: string;
    }>;

    // A sibling already paid: keep the match alive for them, only expire this side.
    if (siblingsList.some((s) => s.payment_status === 'paid')) {
      await this.sendExpiredMessage(row.phone, row.profile_id);
      return;
    }

    // No one paid: cancel the match and release both profiles for re-matching.
    await supabase.from('roommate_matches').update({ status: 'closed' }).eq('id', row.match_id);

    const profileIds = siblingsList.map((s) => s.profile_id);
    if (profileIds.length) {
      await supabase
        .from('roommate_profiles')
        .update({ status: 'new' })
        .in('id', profileIds)
        .eq('status', 'matched');
    }

    await Promise.all(siblingsList.map((s) => this.sendExpiredMessage(s.phone, s.profile_id)));
  }

  /** Sends the "payment link expiring soon" nudge text. */
  private async sendExpiryNudge(row: DueMatchParticipantRow): Promise<void> {
    const [profileRes, siblingRes] = await Promise.all([
      supabase
        .from('roommate_profiles')
        .select('full_name')
        .eq('id', row.profile_id)
        .maybeSingle(),
      this.fetchSiblingProfileId(row.match_id, row.profile_id),
    ]);

    const firstName = (profileRes.data as { full_name?: string } | null)?.full_name?.split(' ')[0] ?? 'there';
    const area = siblingRes ? await this.fetchProfileArea(siblingRes) : '';

    try {
      await whatsappService.sendText(
        row.phone,
        `Hi ${firstName}, just a quick heads-up! Your match payment link for your potential roommate in ${area} will expire in ${MATCH_PAYMENT_NUDGE_BEFORE_HOURS} hours.\n\nIf you still want to connect with them, please complete your payment before it expires so the match isn't canceled.`,
      );
      await supabase.from('match_participants').update({ nudge_sent_at: new Date().toISOString() }).eq('id', row.id);
    } catch (err) {
      console.error('[scheduler] failed to send expiry nudge:', err);
    }
  }

  /** Sends the "payment link expired, match canceled" text. */
  private async sendExpiredMessage(phone: string, profileId: string): Promise<void> {
    const { data } = await supabase
      .from('roommate_profiles')
      .select('full_name')
      .eq('id', profileId)
      .maybeSingle();
    const firstName = (data as { full_name?: string } | null)?.full_name?.split(' ')[0] ?? 'there';

    try {
      await whatsappService.sendText(
        phone,
        `Hi ${firstName}, your payment link has expired and this match has been canceled. Don't worry—you can continue searching for other flatmates on Roommate NG whenever you're ready!`,
      );
    } catch (err) {
      console.error('[scheduler] failed to send expiry message:', err);
    }
  }

  private async fetchProfileArea(profileId: string): Promise<string> {
    const { data } = await supabase
      .from('roommate_profiles')
      .select('preferred_locations')
      .eq('id', profileId)
      .maybeSingle();
    const locs = (data as { preferred_locations?: string[] | null } | null)?.preferred_locations;
    return locs?.[0] ?? '';
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
        "🛡️ *Sido's safety squad — quick wins before you guys link up:*",
        "1. Do a video call first — a roommate who refuses camera calls is a big red flag 🚩",
        "2. Inspect the apartment in daylight and bring a friend along.",
        "3. Sign a roommate/sublet agreement before paying any holding deposit.",
        "4. Never pay via wire transfer, gift cards, or untraceable channels.",
        "5. A price way below the market rate is usually a phantom listing — be careful.",
        '',
        'Roommates NG never collects rent, deposits or inspection fees on behalf of anyone.',
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
    const digits = phoneE164.replace(/\D/g, '');
    const national = digits.startsWith('234') ? digits.slice(3) : digits;
    const variants = [phoneE164, digits, `0${national}`, national];

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
}

export const whatsappLifecycleService = new WhatsAppLifecycleService();
