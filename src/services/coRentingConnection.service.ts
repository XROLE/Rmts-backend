import { randomUUID } from 'node:crypto';
import { supabase } from '../config/supabase.js';
import { getSiteBaseUrl } from '../config/site.js';
import {
  normalizePhoneToE164,
  normalizeAnyPhoneToE164,
  phoneLookupVariants,
} from '../utils/normalizePhone.js';
import { whatsappService } from './whatsapp.service.js';
import { whatsappLifecycleService } from './whatsappLifecycle.service.js';
import { paystackService } from './paystack.service.js';

const FEE_AMOUNT_NGN = Number(process.env.CORENTING_MATCHING_FEE_NGN ?? 2750);
const CREDIT_TOTAL = 7;
const PROCEED_PREFIX = 'CORENT_PROCEED_';
const DECLINE_PREFIX = 'CORENT_DECLINE_';
const ACCEPT_PREFIX = 'CORENT_ACCEPT_';
const REJECT_PREFIX = 'CORENT_REJECT_';
const MATCH_TEMPLATE_NAME = process.env.WHATSAPP_MATCH_TEMPLATE_NAME ?? 'new_match_alert';
const MATCH_TEMPLATE_LANG = process.env.WHATSAPP_MATCH_TEMPLATE_LANG ?? 'en';
const CONNECTION_TRIGGER_PATTERN =
  /^Hi\s+Sido[\s,]+I['’]d\s+like\s+to\s+connect\s+with\s+(.+?)\s*\(ID:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)\s+for\s+co[\s-]?renting\b/i;

const PROFILE_SELECT =
  'id, user_id, full_name, phone_number, email, state, preferred_locations, budget_min, budget_max, occupation, gender, age_range, religion, smoking_habit, allows_pets, sleep_habit, personal_bio, social_handle, status, is_active, is_co_renting, tribe, user_bio, ideal_flatmate_description, deleted_at';

interface ProfileRow {
  id: string;
  user_id: string | null;
  full_name: string;
  phone_number: string;
  email: string | null;
  state: string | null;
  preferred_locations: string[] | null;
  budget_min: number | string | null;
  budget_max: number | string | null;
  occupation: string | null;
  gender: string | null;
  age_range: string | null;
  religion: string | null;
  smoking_habit: string | null;
  allows_pets: boolean | null;
  sleep_habit: string | null;
  personal_bio: string | null;
  social_handle: string | null;
  status: string;
  is_active: boolean | null;
  is_co_renting: boolean;
  tribe: string | null;
  user_bio: string | null;
  ideal_flatmate_description: string | null;
  deleted_at: string | null;
}

interface CreditRow {
  id: string;
  user_id: string;
  credits_total: number;
  credits_remaining: number;
  matches_used: number;
  payment_reference: string | null;
  paid_at: string | null;
}

interface RequestRow {
  id: string;
  requester_user_id: string;
  requester_profile_id: string;
  target_profile_id: string;
  target_name: string;
  payment_reference: string | null;
  state: string;
  status: string;
  credits_deducted: boolean;
  credit_refunded: boolean;
}

interface UserRow {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

function firstName(name?: string | null): string {
  return (name ?? '').trim().split(/\s+/)[0] || 'there';
}

function humanizeLabel(value?: string | null): string {
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

function budgetLabel(min: number | string | null, max: number | string | null): string {
  const lo = Math.round(Number(min ?? 0) / 1000) || 0;
  const hi = Math.round(Number(max ?? 0) / 1000) || lo;
  return hi > lo ? `${lo}k - ${hi}k / year` : `${lo}k / year`;
}

function naira(amount: number): string {
  return `₦${amount.toLocaleString('en-NG')}`;
}

class CoRentingConnectionService {
  matchConnectionTrigger(text: string): { targetName: string; targetId: string } | null {
    const match = CONNECTION_TRIGGER_PATTERN.exec(text.trim());
    if (!match) return null;
    return { targetName: match[1]!.trim(), targetId: match[2]!.toLowerCase() };
  }

  async handleInboundTrigger(phoneE164: string, name: string, text: string): Promise<boolean> {
    const trigger = this.matchConnectionTrigger(text);
    if (!trigger) return false;

    try {
      const target = await this.findTarget(trigger.targetId);
      if (!target) {
        await whatsappService.sendText(
          phoneE164,
          `I couldn't confirm an active co-renter with the ID ${trigger.targetId}. They may no longer be on the Co-Renters Pool. Please pick someone active from the pool and send me the pre-filled message again.`,
        );
        return true;
      }

      const requester = await this.findProfileByPhone(phoneE164);
      if (!requester) {
        await whatsappLifecycleService.sendRegistrationInvite(phoneE164, name);
        await whatsappService.sendText(
          phoneE164,
          `I can help you connect with ${firstName(target.full_name)}, but you need a FairNest profile first. I've just sent you the registration form — complete it, then send me this message again.`,
        );
        return true;
      }

      if (requester.status === 'paused' || requester.status === 'suspended') return false;

      if (requester.id === target.id) {
        await whatsappService.sendText(
          phoneE164,
          "That co-renter profile belongs to you, so there's no connection request to make. You can browse other active co-renters on the Co-Renters Pool instead.",
        );
        return true;
      }

      const userId = await this.resolveUserId(phoneE164, requester, name);
      const request = await this.upsertRequest(userId, requester.id, target.id, target.full_name);
      const credit = await this.getCredits(userId);
      const remaining = credit?.paid_at ? credit.credits_remaining : 0;

      await this.sendExplanation(
        phoneE164,
        firstName(target.full_name),
        remaining,
        Boolean(credit?.paid_at),
      );
      await this.sendChoiceButtons(
        phoneE164,
        requester,
        target,
        `${PROCEED_PREFIX}${target.id}`,
        `${DECLINE_PREFIX}${target.id}`,
      );
      return true;
    } catch (err) {
      console.error('[corenting] inbound trigger failed:', err);
      try {
        await whatsappService.sendText(
          phoneE164,
          "Sorry, I couldn't set up that co-renting connection just now. Please try again in a moment.",
        );
      } catch (sendErr) {
        console.error('[corenting] failed to send error reply:', sendErr);
      }
      return true;
    }
  }

  async handleButtonReply(phoneE164: string, payload: string): Promise<boolean> {
    if (payload.startsWith(PROCEED_PREFIX)) {
      return this.handleProceed(phoneE164, payload.slice(PROCEED_PREFIX.length));
    }
    if (payload.startsWith(DECLINE_PREFIX)) {
      return this.handleDecline(phoneE164, payload.slice(DECLINE_PREFIX.length));
    }
    if (payload.startsWith(ACCEPT_PREFIX)) {
      return this.handleTargetResponse(phoneE164, payload.slice(ACCEPT_PREFIX.length), true);
    }
    if (payload.startsWith(REJECT_PREFIX)) {
      return this.handleTargetResponse(phoneE164, payload.slice(REJECT_PREFIX.length), false);
    }
    return false;
  }

  async fulfillMatchingFee(reference: string): Promise<void> {
    const { data: requestData } = await supabase
      .from('co_renting_connection_requests')
      .select('*')
      .eq('payment_reference', reference)
      .maybeSingle();
    const request = requestData as RequestRow | null;

    if (!request) {
      console.warn('[corenting] no connection request for payment reference:', reference);
      return;
    }
    if (request.state !== 'awaiting_payment') {
      console.log('[corenting] matching fee already fulfilled for request:', request.id);
      return;
    }

    const { data: existingData } = await supabase
      .from('co_renting_match_credits')
      .select('*')
      .eq('user_id', request.requester_user_id)
      .maybeSingle();
    const existing = existingData as CreditRow | null;
    const now = new Date().toISOString();

    let creditId: string;

    if (existing) {
      const { data: updated, error } = await supabase
        .from('co_renting_match_credits')
        .update({
          credits_total: CREDIT_TOTAL,
          credits_remaining: CREDIT_TOTAL,
          matches_used: 0,
          payment_reference: reference,
          paid_at: now,
          updated_at: now,
        })
        .eq('id', existing.id)
        .select('id')
        .single();
      if (error || !updated) {
        throw new Error(`Failed to credit co-renting matches: ${error?.message ?? 'no row'}`);
      }
      creditId = updated.id as string;
    } else {
      const { data: inserted, error } = await supabase
        .from('co_renting_match_credits')
        .insert({
          user_id: request.requester_user_id,
          credits_total: CREDIT_TOTAL,
          credits_remaining: CREDIT_TOTAL,
          matches_used: 0,
          payment_reference: reference,
          paid_at: now,
        })
        .select('id')
        .single();
      if (error || !inserted) {
        throw new Error(`Failed to create co-renting credits: ${error?.message ?? 'no row'}`);
      }
      creditId = inserted.id as string;
    }

    const remaining = CREDIT_TOTAL - 1;
    const { error: spendError } = await supabase
      .from('co_renting_match_credits')
      .update({ credits_remaining: remaining, matches_used: 1, updated_at: now })
      .eq('id', creditId);
    if (spendError) {
      throw new Error(`Failed to spend co-renting match credit: ${spendError.message}`);
    }

    const { error: requestError } = await supabase
      .from('co_renting_connection_requests')
      .update({
        state: 'pending_target_approval',
        status: 'pending_target_approval',
        credits_deducted: true,
        updated_at: now,
      })
      .eq('id', request.id)
      .eq('state', 'awaiting_payment');
    if (requestError) {
      throw new Error(`Failed to update connection request: ${requestError.message}`);
    }

    const [requester, target] = await Promise.all([
      this.findProfileById(request.requester_profile_id),
      this.findProfileById(request.target_profile_id),
    ]);
    if (!requester || !target) {
      throw new Error('Connection request profiles are missing');
    }

    const requesterPhone = this.profilePhone(requester);
    if (!requesterPhone) {
      throw new Error('Requester has no valid WhatsApp phone');
    }

    await whatsappService.sendText(
      requesterPhone,
      `Payment confirmed — your one-time ${naira(FEE_AMOUNT_NGN)} Co-Renting Matching Fee unlocked up to ${CREDIT_TOTAL} matches. Your request to connect with ${firstName(target.full_name)} has been sent! You have ${remaining} of ${CREDIT_TOTAL} matches remaining.`,
    );
    await this.sendTargetOutreach(request.id);
  }

  private async sendExplanation(
    phoneE164: string,
    targetName: string,
    remaining: number,
    hasPaid: boolean,
  ): Promise<void> {
    const feeStep = hasPaid
      ? `2. You've already paid the one-time ${naira(FEE_AMOUNT_NGN)} Co-Renting Matching Fee — you have ${remaining} of ${CREDIT_TOTAL} matches remaining, so nothing more to pay.`
      : `2. Complete a one-time Co-Renting Matching Fee of ${naira(FEE_AMOUNT_NGN)} (unlocks up to ${CREDIT_TOTAL} different match connections).`;

    const body = [
      "Here's how the Co-Renting Hub works before you decide 👇",
      '',
      'WHAT THE CO-RENTING HUB IS',
      'The Co-Renting Hub connects people with a similar budget, location, interests and lifestyle so you can become friends, combine resources and rent an apartment of your own choice together.',
      'IMPORTANT: the people listed in the pool do NOT already have an apartment. You both team up to pool funds and secure a place together.',
      '',
      'WHY CO-RENTING IS GOOD',
      `• Higher combined renting power — pooling budgets unlocks better neighbourhoods, serviced estates and spacious apartments you couldn't easily afford solo.`,
      "• Choose your flatmate first — align on lifestyle, habits and house rules before committing to a lease, instead of moving into a stranger's pre-set rules.",
      '• Shared costs — split annual rent, agency/legal fees, caution deposits and recurring diesel/service charges fairly.',
      '',
      'HOW IT WORKS',
      `1. Confirm you want to proceed with connecting to ${targetName}.`,
      feeStep,
      `3. Sido notifies ${targetName} on WhatsApp to confirm mutual interest.`,
      `4. Once ${targetName} accepts, Sido shares your contact details and introduces you both so you can chat, meet safely and plan your apartment search together.`,
      '',
      'Choose an option below.',
    ].join('\n');

    await whatsappService.sendText(phoneE164, body);
  }

  private async sendChoiceButtons(
    phoneE164: string,
    recipient: ProfileRow,
    other: ProfileRow,
    proceedPayload: string,
    declinePayload: string,
  ): Promise<void> {
    await whatsappService.sendTemplate({
      to: phoneE164,
      name: MATCH_TEMPLATE_NAME,
      language: MATCH_TEMPLATE_LANG,
      bodyParams: this.buildAlertParams(recipient, other),
      buttonPayloads: [proceedPayload, declinePayload],
    });
  }

  private buildAlertParams(recipient: ProfileRow, other: ProfileRow): string[] {
    const lifestyle = [
      other.allows_pets != null ? (other.allows_pets ? 'Pet-friendly' : 'No pets') : '',
      other.sleep_habit ? humanizeLabel(other.sleep_habit) : '',
      other.tribe ? `Tribe: ${other.tribe}` : '',
    ]
      .filter(Boolean)
      .join(', ');
    const bio =
      other.personal_bio?.trim() ||
      other.user_bio?.trim() ||
      other.ideal_flatmate_description?.trim() ||
      'No bio was provided yet — ask about their lifestyle before agreeing to live together.';

    return [
      firstName(recipient.full_name),
      other.preferred_locations?.[0] ?? '',
      other.state ?? '',
      budgetLabel(other.budget_min, other.budget_max),
      humanizeLabel(other.gender),
      other.age_range ?? '',
      humanizeLabel(other.occupation),
      other.religion ?? '',
      humanizeLabel(other.smoking_habit),
      lifestyle ? `${bio} — ${lifestyle}` : bio,
    ];
  }

  private async handleProceed(phoneE164: string, targetId: string): Promise<boolean> {
    const requester = await this.findProfileByPhone(phoneE164);
    if (!requester) {
      await whatsappService.sendText(
        phoneE164,
        "I couldn't find your profile, so I can't process that connection. Please register first.",
      );
      return true;
    }

    const userId = await this.resolveUserId(phoneE164, requester, requester.full_name);
    const { data: requestData } = await supabase
      .from('co_renting_connection_requests')
      .select('*')
      .eq('requester_user_id', userId)
      .eq('target_profile_id', targetId)
      .in('state', ['awaiting_requester_decision', 'awaiting_payment', 'pending_target_approval'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const request = requestData as RequestRow | null;

    if (!request) {
      await whatsappService.sendText(
        phoneE164,
        "I couldn't find that pending connection request. Send the pre-filled co-renting message again and I'll set it up for you.",
      );
      return true;
    }

    if (request.state === 'pending_target_approval') {
      await whatsappService.sendText(
        phoneE164,
        "Your connection request has already been sent — I'm just waiting for them to confirm. I'll introduce you both as soon as they accept.",
      );
      return true;
    }

    if (request.state === 'awaiting_payment') {
      await whatsappService.sendText(
        phoneE164,
        'Your payment link for this connection has already been sent. Complete that payment and I will forward your request straight away.',
      );
      return true;
    }

    const target = await this.findTarget(targetId);
    if (!target) {
      await whatsappService.sendText(
        phoneE164,
        'That co-renter is no longer active on the pool, so I cannot send the request. Please choose someone else.',
      );
      return true;
    }

    const credit = await this.getCredits(userId);
    if (!credit?.paid_at || credit.credits_remaining <= 0) {
      await this.issuePaymentLink(phoneE164, userId, request, requester, target);
      return true;
    }

    await this.consumeCreditAndSend(phoneE164, credit, request, requester, target);
    return true;
  }

  private async issuePaymentLink(
    phoneE164: string,
    userId: string,
    request: RequestRow,
    requester: ProfileRow,
    target: ProfileRow,
  ): Promise<void> {
    const user = await this.findUserById(userId);
    if (!user) {
      throw new Error('Requester user account is missing');
    }

    const reference = randomUUID();
    const initialized = await paystackService.initializePayment({
      amountKobo: Math.round(FEE_AMOUNT_NGN * 100),
      email: user.email ?? `${phoneE164.replace(/\D/g, '')}@fairnesthousing.com`,
      reference,
      callbackUrl: process.env.PAYMENT_RETURN_URL,
      metadata: {
        payment_type: 'corenting_matching_fee',
        requester_id: userId,
        target_roommate_id: target.id,
        match_request_id: request.id,
        purpose: 'corenting_matching_fee',
        phone: phoneE164,
        name: requester.full_name,
      },
    });

    const now = new Date().toISOString();
    const { error: txnError } = await supabase.from('transactions').insert({
      reference,
      user_phone: user.phone ?? phoneE164,
      amount: FEE_AMOUNT_NGN,
      status: 'PENDING',
      purpose: 'corenting_matching_fee',
      created_at: now,
    });
    if (txnError) {
      throw new Error(`Failed to record co-renting fee transaction: ${txnError.message}`);
    }

    const { error: requestError } = await supabase
      .from('co_renting_connection_requests')
      .update({ state: 'awaiting_payment', payment_reference: reference, updated_at: now })
      .eq('id', request.id);
    if (requestError) {
      throw new Error(`Failed to attach payment reference: ${requestError.message}`);
    }

    await whatsappService.sendText(
      phoneE164,
      `This is a one-time ${naira(FEE_AMOUNT_NGN)} Co-Renting Matching Fee. It unlocks up to ${CREDIT_TOTAL} match connections and covers 24hr AI-assisted support on WhatsApp.\n\nOnce the payment is confirmed, I'll immediately send your connection request to ${firstName(target.full_name)}.`,
    );
    await whatsappService.sendCtaUrlButton({
      to: phoneE164,
      displayText: `Pay ${naira(FEE_AMOUNT_NGN)} now`,
      url: initialized.authorizationUrl,
      header: 'Co-Renting Matching Fee',
      body: `Pay the one-time ${naira(FEE_AMOUNT_NGN)} fee to connect with ${firstName(target.full_name)}.`,
    });
  }

  private async consumeCreditAndSend(
    phoneE164: string,
    credit: CreditRow,
    request: RequestRow,
    requester: ProfileRow,
    target: ProfileRow,
  ): Promise<void> {
    const remaining = Math.max(0, credit.credits_remaining - 1);
    const now = new Date().toISOString();
    const { error: creditError } = await supabase
      .from('co_renting_match_credits')
      .update({ credits_remaining: remaining, matches_used: credit.matches_used + 1, updated_at: now })
      .eq('id', credit.id);
    if (creditError) {
      throw new Error(`Failed to spend co-renting match credit: ${creditError.message}`);
    }

    const { error: requestError } = await supabase
      .from('co_renting_connection_requests')
      .update({
        state: 'pending_target_approval',
        status: 'pending_target_approval',
        credits_deducted: true,
        updated_at: now,
      })
      .eq('id', request.id);
    if (requestError) {
      throw new Error(`Failed to update connection request: ${requestError.message}`);
    }

    await whatsappService.sendText(
      phoneE164,
      `Your request to connect with ${firstName(target.full_name)} has been sent! You have ${remaining} of ${CREDIT_TOTAL} matches remaining.`,
    );
    await this.sendTargetOutreach(request.id);
  }

  private async sendTargetOutreach(requestId: string): Promise<void> {
    const request = await this.loadRequest(requestId);
    if (!request || request.state !== 'pending_target_approval') {
      console.warn('[corenting] target outreach skipped for request:', requestId);
      return;
    }

    const [requester, target] = await Promise.all([
      this.findProfileById(request.requester_profile_id),
      this.findProfileById(request.target_profile_id),
    ]);
    if (!requester || !target) {
      throw new Error('Connection request profiles are missing');
    }

    const targetPhone = this.profilePhone(target);
    if (!targetPhone) {
      throw new Error('Target co-renter has no valid WhatsApp phone');
    }

    await this.sendChoiceButtons(
      targetPhone,
      target,
      requester,
      `${ACCEPT_PREFIX}${request.id}`,
      `${REJECT_PREFIX}${request.id}`,
    );
  }

  private async handleDecline(phoneE164: string, targetId: string): Promise<boolean> {
    const requester = await this.findProfileByPhone(phoneE164);
    if (requester) {
      const userId = await this.resolveUserId(phoneE164, requester, requester.full_name);
      await supabase
        .from('co_renting_connection_requests')
        .update({ state: 'declined_by_requester', status: 'declined_by_requester', updated_at: new Date().toISOString() })
        .eq('requester_user_id', userId)
        .eq('target_profile_id', targetId)
        .in('state', ['awaiting_requester_decision', 'awaiting_payment']);
    }

    await whatsappService.sendText(
      phoneE164,
      "No problem — I haven't contacted them, so no action was taken. Reach back out whenever you're ready and I'll pick this up.",
    );
    return true;
  }

  private async handleTargetResponse(
    phoneE164: string,
    requestId: string,
    accepted: boolean,
  ): Promise<boolean> {
    const request = await this.loadRequest(requestId);
    if (!request) {
      await whatsappService.sendText(phoneE164, "I couldn't find that connection request.");
      return true;
    }
    if (request.state !== 'pending_target_approval') {
      await whatsappService.sendText(
        phoneE164,
        'This connection request has already been answered. No further action is needed.',
      );
      return true;
    }

    const [requester, target] = await Promise.all([
      this.findProfileById(request.requester_profile_id),
      this.findProfileById(request.target_profile_id),
    ]);
    if (!requester || !target) {
      await whatsappService.sendText(phoneE164, 'The profiles for this request are no longer available.');
      return true;
    }

    const targetPhone = this.profilePhone(target);
    if (!targetPhone || !phoneLookupVariants(targetPhone).includes(phoneE164)) {
      await whatsappService.sendText(
        phoneE164,
        "Only the person being asked can accept or decline this co-renting request.",
      );
      return true;
    }

    const requesterPhone = this.profilePhone(requester);
    const now = new Date().toISOString();

    if (!accepted) {
      const { error } = await supabase
        .from('co_renting_connection_requests')
        .update({
          state: 'declined',
          status: 'declined',
          credit_refunded: true,
          declined_at: now,
          updated_at: now,
        })
        .eq('id', request.id)
        .eq('state', 'pending_target_approval');
      if (error) {
        throw new Error(`Failed to decline connection request: ${error.message}`);
      }

      await this.refundCredit(request.requester_user_id);
      const credit = await this.getCredits(request.requester_user_id);
      const remaining = credit?.paid_at ? credit.credits_remaining : CREDIT_TOTAL;

      if (requesterPhone) {
        await whatsappService.sendText(
          requesterPhone,
          `${firstName(target.full_name)} has declined this connection request, so no contact details were shared. Your match slot has been refunded — you have ${remaining} of ${CREDIT_TOTAL} matches remaining.\n\nYou can browse other active co-renters on the Co-Renters Pool: ${getSiteBaseUrl()}/co-renting-hub`,
        );
      }
      await whatsappService.sendText(
        phoneE164,
        `Thanks for letting us know, ${firstName(target.full_name)}. I've let them know and released their match slot.`,
      );
      return true;
    }

    const { error } = await supabase
      .from('co_renting_connection_requests')
      .update({ state: 'connected', status: 'connected', connected_at: now, updated_at: now })
      .eq('id', request.id)
      .eq('state', 'pending_target_approval');
    if (error) {
      throw new Error(`Failed to connect co-renters: ${error.message}`);
    }

    const safety =
      'FairNest safety reminder: meet in a public place first, agree on house rules and budgets upfront, and never transfer rent to an individual\'s personal account.';

    if (requesterPhone) {
      await whatsappService.sendText(
        requesterPhone,
        [
          `🎉 You're connected with ${target.full_name}!`,
          '',
          `📱 WhatsApp: ${targetPhone}`,
          target.social_handle ? `🔗 Social: ${target.social_handle}` : '',
          '',
          `I've shared your contact details with ${firstName(target.full_name)} too, so you can chat directly and plan your apartment search together.`,
          '',
          safety,
          '',
          `Once you're both ready to inspect and rent an apartment together, reply here and I'll help you with FairNest's property sourcing.`,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }

    await whatsappService.sendText(
      phoneE164,
      [
        `🎉 ${requester.full_name} accepted and you're now connected!`,
        '',
        `👤 Name: ${requester.full_name}`,
        requesterPhone ? `📱 WhatsApp: ${requesterPhone}` : '',
        requester.social_handle ? `🔗 Social: ${requester.social_handle}` : '',
        '',
        `You can now chat directly and plan your apartment search together.`,
        '',
        safety,
        '',
        "Once you're both ready to inspect and rent an apartment together, reply here and I'll help you with FairNest's property sourcing.",
      ]
        .filter(Boolean)
        .join('\n'),
    );
    return true;
  }

  private async refundCredit(userId: string): Promise<void> {
    const credit = await this.getCredits(userId);
    if (!credit) return;
    const remaining = Math.min(credit.credits_total, credit.credits_remaining + 1);
    const matchesUsed = Math.max(0, credit.matches_used - 1);
    const { error } = await supabase
      .from('co_renting_match_credits')
      .update({ credits_remaining: remaining, matches_used: matchesUsed, updated_at: new Date().toISOString() })
      .eq('id', credit.id);
    if (error) {
      throw new Error(`Failed to refund co-renting match credit: ${error.message}`);
    }
  }

  private async findTarget(id: string): Promise<ProfileRow | null> {
    const { data, error } = await supabase
      .from('roommate_profiles')
      .select(PROFILE_SELECT)
      .eq('id', id)
      .is('deleted_at', null)
      .eq('is_co_renting', true)
      .eq('is_active', true)
      .eq('status', 'active')
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to look up target co-renter: ${error.message}`);
    }
    return (data as ProfileRow | null) ?? null;
  }

  private async findProfileById(id: string): Promise<ProfileRow | null> {
    const { data, error } = await supabase
      .from('roommate_profiles')
      .select(PROFILE_SELECT)
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to look up profile: ${error.message}`);
    }
    return (data as ProfileRow | null) ?? null;
  }

  private async findProfileByPhone(phoneE164: string): Promise<ProfileRow | null> {
    const { data, error } = await supabase
      .from('roommate_profiles')
      .select(PROFILE_SELECT)
      .in('phone_number', phoneLookupVariants(phoneE164))
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to look up requester profile: ${error.message}`);
    }
    return (data as ProfileRow | null) ?? null;
  }

  private async findUserById(id: string): Promise<UserRow | null> {
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, email, phone')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to look up user: ${error.message}`);
    }
    return (data as UserRow | null) ?? null;
  }

  private async resolveUserId(phoneE164: string, profile: ProfileRow, name?: string): Promise<string> {
    if (profile.user_id) {
      const user = await this.findUserById(profile.user_id);
      if (user) return user.id;
    }

    const { data: byPhone } = await supabase
      .from('users')
      .select('id')
      .in('phone', phoneLookupVariants(phoneE164))
      .maybeSingle();
    if (byPhone) return byPhone.id as string;

    const created = await whatsappLifecycleService.ensureUser(
      phoneE164,
      profile.full_name || name || 'Friend',
    );
    return created.id;
  }

  private async getCredits(userId: string): Promise<CreditRow | null> {
    const { data, error } = await supabase
      .from('co_renting_match_credits')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to look up co-renting credits: ${error.message}`);
    }
    return (data as CreditRow | null) ?? null;
  }

  private async loadRequest(id: string): Promise<RequestRow | null> {
    const { data, error } = await supabase
      .from('co_renting_connection_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to load connection request: ${error.message}`);
    }
    return (data as RequestRow | null) ?? null;
  }

  private async upsertRequest(
    userId: string,
    requesterProfileId: string,
    targetProfileId: string,
    targetName: string,
  ): Promise<RequestRow> {
    const { data: existing } = await supabase
      .from('co_renting_connection_requests')
      .select('*')
      .eq('requester_user_id', userId)
      .eq('target_profile_id', targetProfileId)
      .in('state', ['awaiting_requester_decision', 'awaiting_payment', 'pending_target_approval'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) return existing as RequestRow;

    const { data, error } = await supabase
      .from('co_renting_connection_requests')
      .insert({
        requester_user_id: userId,
        requester_profile_id: requesterProfileId,
        target_profile_id: targetProfileId,
        target_name: targetName,
      })
      .select('*')
      .single();
    if (error || !data) {
      throw new Error(`Failed to create connection request: ${error?.message ?? 'no row'}`);
    }
    return data as RequestRow;
  }

  private profilePhone(profile: ProfileRow): string | null {
    return normalizePhoneToE164(profile.phone_number) ?? normalizeAnyPhoneToE164(profile.phone_number);
  }
}

export const coRentingConnectionService = new CoRentingConnectionService();
