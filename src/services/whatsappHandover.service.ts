import 'dotenv/config';
import { createHmac, randomUUID } from 'node:crypto';
import { HttpError } from '../middleware/errorHandler.js';
import { supabase } from '../config/supabase.js';
import { whatsappService } from './whatsapp.service.js';
import { paymentService } from './payment.service.js';
import { normalizePhoneToE164 } from '../utils/normalizePhone.js';

interface HandoverRow {
  id: string;
  match_id: string;
  status: string;
  user_a_profile_id: string;
  user_b_profile_id: string;
  user_a_phone: string;
  user_b_phone: string;
  user_a_response: 'pending' | 'accepted' | 'declined';
  user_b_response: 'pending' | 'accepted' | 'declined';
  user_a_wam_id: string | null;
  user_b_wam_id: string | null;
  payment_link_a_id: string | null;
  payment_link_b_id: string | null;
  error: string | null;
}

interface ProfileRow {
  id: string;
  full_name: string;
  gender?: string | null;
  age_range?: string | null;
  occupation?: string | null;
  preferred_locations?: string[] | null;
  budget_min?: number | null;
  budget_max?: number | null;
  expected_move_in_date?: string | null;
  allows_pets?: boolean | null;
  sleep_habit?: string | null;
  phone_number: string;
}

const FLOW_TOKEN_TTL_SECONDS = 60 * 60 * 24; // 24h session
const FLOW_ACCEPT_DECLINE_ID = process.env.WHATSAPP_FLOW_ACCEPT_DECLINE_ID ?? '';
const FLOW_PAYMENT_ID = process.env.WHATSAPP_FLOW_PAYMENT_ID ?? '';
const MATCH_PAYMENT_AMOUNT_NGN = Number(process.env.WHATSAPP_MATCH_PAYMENT_AMOUNT_NGN ?? 10000);

function flowTokenSecret(): string {
  const secret = process.env.WHATSAPP_FLOW_TOKEN_SECRET;
  if (!secret) {
    throw new HttpError(500, 'WHATSAPP_FLOW_TOKEN_SECRET is not configured');
  }
  return secret;
}

const b64url = (buf: Buffer) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function signFlowToken(payload: Record<string, unknown>): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(
    Buffer.from(
      JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + FLOW_TOKEN_TTL_SECONDS }),
    ),
  );
  const sig = b64url(
    createHmac('sha256', flowTokenSecret()).update(`${header}.${body}`).digest(),
  );
  return `${header}.${body}.${sig}`;
}

function verifyFlowToken(token: string): {
  matchId: string;
  side: 'a' | 'b';
} | null {
  try {
    const [header, body, sig] = token.split('.');
    if (!header || !body || !sig) return null;
    const expectedSig = b64url(
      createHmac('sha256', flowTokenSecret()).update(`${header}.${body}`).digest(),
    );
    if (expectedSig !== sig) return null;

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as {
      matchId?: string;
      side?: 'a' | 'b';
      exp?: number;
    };
    if (!payload.matchId || !payload.side) return null;
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;

    return { matchId: payload.matchId, side: payload.side };
  } catch {
    return null;
  }
}

/**
 * Drives the WhatsApp Flows handover for a confirmed roommate match:
 *   1. Send both roommates an accept/decline Flow with a sanitized profile card
 *   2. When both accept, create + send each a Paystack payment link via Flow
 *   3. When either declines, close the match and return both profiles to 'rematch'
 */
export class WhatsAppHandoverService {
  /**
   * Kicks off a handover for a freshly confirmed match, DMing both roommates.
   * Called non-blocking from the match service so a WhatsApp failure never
   * rolls back a confirmed match.
   */
  async startHandover(
    match: { id: string; roommate_profile_a_id: string; roommate_profile_b_id: string },
  ) {
    const profileA = await this.fetchProfile(match.roommate_profile_a_id);
    const profileB = await this.fetchProfile(match.roommate_profile_b_id);

    const phoneA = normalizePhoneToE164(profileA.phone_number);
    const phoneB = normalizePhoneToE164(profileB.phone_number);

    if (!phoneA || !phoneB) {
      throw new HttpError(
        400,
        'Both roommates need valid Nigerian phone numbers to start a WhatsApp handover',
      );
    }

    if (!FLOW_ACCEPT_DECLINE_ID) {
      throw new HttpError(500, 'WHATSAPP_FLOW_ACCEPT_DECLINE_ID is not configured');
    }

    const { data: handover, error } = await supabase
      .from('match_whatsapp_handovers')
      .insert({
        match_id: match.id,
        status: 'initiated',
        user_a_profile_id: profileA.id,
        user_b_profile_id: profileB.id,
        user_a_phone: phoneA,
        user_b_phone: phoneB,
      })
      .select('*')
      .single();

    if (error || !handover) {
      throw new HttpError(500, `Failed to create handover: ${error?.message}`);
    }

    await this.sendIntroAndFlow(handover as HandoverRow, profileA, profileB, phoneA, 'a');
    await this.sendIntroAndFlow(handover as HandoverRow, profileB, profileA, phoneB, 'b');

    await supabase
      .from('match_whatsapp_handovers')
      .update({ status: 'sent' })
      .eq('id', handover.id);
  }

  private async sendIntroAndFlow(
    handover: HandoverRow,
    viewer: ProfileRow,
    matchProfile: ProfileRow,
    phone: string,
    side: 'a' | 'b',
  ) {
    const card = this.buildProfileCard(matchProfile);
    const flowToken = signFlowToken({ matchId: handover.match_id, side });

    const { wamId } = await whatsappService.sendFlowMessage({
      to: phone,
      flowId: FLOW_ACCEPT_DECLINE_ID,
      cta: 'Review match',
      header: `Hi ${viewer.full_name.split(' ')[0] ?? 'there'}!`,
      body: `We found you a roommate match. Here's a quick look:\n\n${card}\n\nTap below to open the form and accept or decline.`,
      flowToken,
      initialData: {
        match_id: handover.match_id,
        side,
        to_review: this.buildProfileCard(matchProfile),
      },
    });

    await supabase
      .from('match_whatsapp_handovers')
      .update({
        [side === 'a' ? 'user_a_wam_id' : 'user_b_wam_id']: wamId,
      })
      .eq('id', handover.id);
  }

  /**
   * Handles an inbound Flow submission (nfm_reply). Resolves the handover and
   * side from the flow_token, then applies the accept/decline.
   */
  async handleFlowResponse(flowToken: string, responseJson: Record<string, unknown>) {
    const ctx = verifyFlowToken(flowToken);
    if (!ctx) {
      console.warn('[whatsapp] discarded flow response with invalid/expired token');
      return { handled: false };
    }

    const { data: handover, error } = await supabase
      .from('match_whatsapp_handovers')
      .select('*')
      .eq('match_id', ctx.matchId)
      .maybeSingle();

    if (error || !handover) {
      throw new HttpError(404, 'No handover found for this flow response');
    }

    const response = String(responseJson.accept ?? '');
    if (response !== 'accepted' && response !== 'declined') {
      console.warn('[whatsapp] unexpected flow response value:', response);
      return { handled: true, ignored: true };
    }

    const isA = ctx.side === 'a';
    if (isA) {
      if (handover.user_a_response !== 'pending') return { handled: true, duplicate: true };
      await this.recordResponse(handover.id, 'user_a_response', response, 'user_a_responded_at');
    } else {
      if (handover.user_b_response !== 'pending') return { handled: true, duplicate: true };
      await this.recordResponse(handover.id, 'user_b_response', response, 'user_b_responded_at');
    }

    if (response === 'declined') {
      await this.handleDecline(handover, ctx.side);
      return { handled: true, outcome: 'declined' };
    }

    const { data: updated, error: reloadError } = await supabase
      .from('match_whatsapp_handovers')
      .select('*')
      .eq('id', handover.id)
      .single();

    if (reloadError || !updated) {
      throw new HttpError(500, `Failed to reload handover: ${reloadError?.message}`);
    }

    const bothAccepted =
      updated.user_a_response === 'accepted' && updated.user_b_response === 'accepted';

    if (bothAccepted) {
      await supabase
        .from('match_whatsapp_handovers')
        .update({ status: 'both_accepted' })
        .eq('id', updated.id);
      await this.handleBothAccepted(updated as HandoverRow);
      return { handled: true, outcome: 'both_accepted' };
    }

    await supabase
      .from('match_whatsapp_handovers')
      .update({ status: 'partial_accept' })
      .eq('id', updated.id);

    return { handled: true, outcome: 'partial_accept' };
  }

  private async recordResponse(
    handoverId: string,
    responseColumn: 'user_a_response' | 'user_b_response',
    response: 'accepted' | 'declined',
    respondedAtColumn: 'user_a_responded_at' | 'user_b_responded_at',
  ) {
    const { error } = await supabase
      .from('match_whatsapp_handovers')
      .update({
        [responseColumn]: response,
        [respondedAtColumn]: new Date().toISOString(),
      })
      .eq('id', handoverId);
    if (error) {
      throw new HttpError(500, `Failed to record response: ${error.message}`);
    }
  }

  /**
   * Creates and sends a Paystack payment link Flow to each roommate once both
   * have accepted the match.
   */
  private async handleBothAccepted(handover: HandoverRow) {
    if (!FLOW_PAYMENT_ID) {
      throw new HttpError(500, 'WHATSAPP_FLOW_PAYMENT_ID is not configured');
    }

    if (!handover.payment_link_a_id) {
      const linkA = await paymentService.createPaymentLink(
        handover.user_a_profile_id,
        { roommateProfileId: handover.user_a_profile_id, amountNg: MATCH_PAYMENT_AMOUNT_NGN },
      );
      await supabase
        .from('match_whatsapp_handovers')
        .update({ payment_link_a_id: linkA.paymentLink.id })
        .eq('id', handover.id);
      await this.sendPaymentFlow(handover.user_a_phone, linkA.authorizationUrl, handover.match_id, 'a');
    }

    if (!handover.payment_link_b_id) {
      const linkB = await paymentService.createPaymentLink(
        handover.user_b_profile_id,
        { roommateProfileId: handover.user_b_profile_id, amountNg: MATCH_PAYMENT_AMOUNT_NGN },
      );
      await supabase
        .from('match_whatsapp_handovers')
        .update({ payment_link_b_id: linkB.paymentLink.id })
        .eq('id', handover.id);
      await this.sendPaymentFlow(handover.user_b_phone, linkB.authorizationUrl, handover.match_id, 'b');
    }

    await supabase
      .from('match_whatsapp_handovers')
      .update({ status: 'payment_sent' })
      .eq('id', handover.id);
  }

  private async sendPaymentFlow(
    phone: string,
    authorizationUrl: string,
    matchId: string,
    side: 'a' | 'b',
  ) {
    const flowToken = signFlowToken({ matchId, side });
    await whatsappService.sendFlowMessage({
      to: phone,
      flowId: FLOW_PAYMENT_ID,
      cta: 'Pay now',
      header: 'Payment',
      body: 'Your match is confirmed! Tap below to complete your payment and connect with your roommate.',
      flowToken,
      initialData: { match_id: matchId, side, authorization_url: authorizationUrl },
    });
  }

  /**
   * Closes the match and returns both profiles to 'rematch' when either user
   * declines.
   */
  private async handleDecline(handover: HandoverRow, declinedSide: 'a' | 'b') {
    const declinedProfileId =
      declinedSide === 'a' ? handover.user_a_profile_id : handover.user_b_profile_id;
    const otherProfileId =
      declinedSide === 'a' ? handover.user_b_profile_id : handover.user_a_profile_id;

    await supabase
      .from('match_whatsapp_handovers')
      .update({ status: 'declined', error: `Declined by ${declinedProfileId}` })
      .eq('id', handover.id);

    await supabase
      .from('roommate_matches')
      .update({ status: 'closed', updated_at: new Date().toISOString() })
      .eq('id', handover.match_id)
      .eq('status', 'active');

    await supabase
      .from('roommate_profiles')
      .update({ status: 'rematch' })
      .in('id', [declinedProfileId, otherProfileId]);

    try {
      await whatsappService.sendFlowMessage({
        to: declinedSide === 'a' ? handover.user_a_phone : handover.user_b_phone,
        flowId: FLOW_ACCEPT_DECLINE_ID,
        cta: 'Try again',
        header: 'Match closed',
        body: 'You declined this match. We will look for a better one for you.',
        flowToken: signFlowToken({ matchId: handover.match_id, side: declinedSide }),
      });
    } catch (err) {
      console.error('[whatsapp] failed to send decline notice:', err);
    }
  }

  /**
   * Returns a sanitized, non-PII summary of a roommate profile. Deliberately
   * omits name, phone, email and religion to keep the handover privacy-safe.
   */
  private buildProfileCard(profile: ProfileRow): string {
    const lines: string[] = [];
    const budget = [profile.budget_min, profile.budget_max]
      .filter((n): n is number => typeof n === 'number')
      .map((n) => `₦${n.toLocaleString()}`)
      .join(' - ');
    if (profile.age_range) lines.push(`Age: ${profile.age_range}`);
    if (profile.occupation) lines.push(`Occupation: ${profile.occupation}`);
    if (profile.preferred_locations?.length) {
      lines.push(`Areas: ${profile.preferred_locations.join(', ')}`);
    }
    if (budget) lines.push(`Budget: ${budget}`);
    if (profile.expected_move_in_date) {
      lines.push(`Move-in: ${profile.expected_move_in_date}`);
    }
    if (typeof profile.allows_pets === 'boolean') {
      lines.push(`Pets: ${profile.allows_pets ? 'Allowed' : 'Not allowed'}`);
    }
    if (profile.sleep_habit) lines.push(`Sleep: ${profile.sleep_habit}`);
    if (lines.length === 0) return 'No details available.';
    return lines.join('\n');
  }

  private async fetchProfile(profileId: string): Promise<ProfileRow> {
    const { data, error } = await supabase
      .from('roommate_profiles')
      .select(
        'id, full_name, gender, age_range, occupation, preferred_locations, budget_min, budget_max, expected_move_in_date, allows_pets, sleep_habit, phone_number',
      )
      .eq('id', profileId)
      .single();

    if (error || !data) {
      throw new HttpError(404, `Roommate profile ${profileId} not found`);
    }
    return data as ProfileRow;
  }
}

export const whatsappHandoverService = new WhatsAppHandoverService();
