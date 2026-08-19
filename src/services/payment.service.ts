import { randomUUID } from 'node:crypto';
import { HttpError } from '../middleware/errorHandler.js';
import { supabase } from '../config/supabase.js';
import { paystackService } from './paystack.service.js';
import { resolveAccountNumber, resolveBankCode } from './ambassador.service.js';
import { matchService } from './match.service.js';
import type {
  CreatePaymentLinkInput,
  RequestWithdrawalInput,
} from '../schemas/payment.schema.js';

const COMMISSION_PERCENT = Number(process.env.COMMISSION_PERCENT ?? 10);
const MIN_WITHDRAWAL_AMOUNT = Number(process.env.MIN_WITHDRAWAL_AMOUNT ?? 1000);
const PAYMENT_RETURN_URL = process.env.PAYMENT_RETURN_URL;

function commissionFor(amountNg: number): number {
  return Number(((amountNg * COMMISSION_PERCENT) / 100).toFixed(2));
}

function nairaToKobo(amountNg: number): number {
  return Math.round(amountNg * 100);
}

export class PaymentService {
  /**
   * Resolves the roommate's ambassador from their referral code and issues a
   * Paystack payment link. A pending commission is recorded immediately.
   * The roommate must have an active match; the link records the match and
   * the matched partner so the pairing is visible from the record.
   */
  async createPaymentLink(userId: string, input: CreatePaymentLinkInput) {
    const { roommateProfileId, amountNg } = input;

    const { data: roommate, error: roommateError } = await supabase
      .from('roommate_profiles')
      .select('id, email, referred_by_code, full_name, preferred_locations')
      .eq('id', roommateProfileId)
      .single();

    if (roommateError || !roommate) {
      throw new HttpError(404, 'Roommate profile not found');
    }

    const match = await matchService.getActiveMatchForProfile(roommateProfileId);
    if (!match) {
      throw new HttpError(
        409,
        'Roommate has no active match. Confirm a match before generating a payment link.',
      );
    }

    const matchedRoommateProfileId =
      match.roommate_profile_a_id === roommateProfileId
        ? match.roommate_profile_b_id
        : match.roommate_profile_a_id;

    const { data: matchedRoommate } = await supabase
      .from('roommate_profiles')
      .select('id, full_name')
      .eq('id', matchedRoommateProfileId)
      .maybeSingle();

    const referralCode = roommate.referred_by_code;
    if (!referralCode) {
      throw new HttpError(
        400,
        'This roommate has no referral code, so no commission can be credited',
      );
    }

    const { data: ambassador, error: ambassadorError } = await supabase
      .from('ambassador_profiles')
      .select('id, user_id, pending_balance_ngn')
      .eq('referral_code', referralCode)
      .maybeSingle();

    if (ambassadorError || !ambassador) {
      throw new HttpError(404, 'Ambassador for referral code not found');
    }

    const reference = randomUUID();
    const initialized = await paystackService.initializePayment({
      amountKobo: nairaToKobo(amountNg),
      email: roommate.email ?? 'no-email@roommateng.com',
      reference,
      callbackUrl: PAYMENT_RETURN_URL,
      metadata: {
        referral_code: referralCode,
        roommate_profile_id: roommateProfileId,
        ambassador_user_id: ambassador.user_id,
        match_id: match.id,
        matched_roommate_profile_id: matchedRoommateProfileId,
      },
    });

    const { data: paymentLink, error: linkError } = await supabase
      .from('payment_links')
      .insert({
        roommate_profile_id: roommateProfileId,
        ambassador_user_id: ambassador.user_id,
        referral_code: referralCode,
        amount_ngn: amountNg,
        paystack_reference: reference,
        paystack_access_code: initialized.accessCode,
        paystack_authorization_url: initialized.authorizationUrl,
        match_id: match.id,
        matched_roommate_profile_id: matchedRoommateProfileId,
        status: 'pending',
      })
      .select('*')
      .single();

    if (linkError || !paymentLink) {
      throw new HttpError(500, `Failed to store payment link: ${linkError?.message}`);
    }

    const commission = commissionFor(amountNg);

    const { data: commissionRecord, error: commissionError } = await supabase
      .from('commission_earnings')
      .insert({
        ambassador_user_id: ambassador.user_id,
        roommate_profile_id: roommateProfileId,
        payment_link_id: paymentLink.id,
        amount_ngn: commission,
        referral_code: referralCode,
        status: 'pending',
        paystack_reference: reference,
      })
      .select('*')
      .single();

    if (commissionError || !commissionRecord) {
      throw new HttpError(
        500,
        `Failed to record commission: ${commissionError?.message}`,
      );
    }

    const { error: balanceError } = await supabase
      .from('ambassador_profiles')
      .update({ pending_balance_ngn: ambassador.pending_balance_ngn + commission })
      .eq('id', ambassador.id);

    if (balanceError) {
      console.error('Failed to update pending balance:', balanceError.message);
    }

    // Move the paying roommate along the lifecycle: matched -> pending_payment.
    const { error: statusError } = await supabase
      .from('roommate_profiles')
      .update({ status: 'pending_payment' })
      .eq('id', roommateProfileId)
      .eq('status', 'matched');

    if (statusError) {
      console.error('Failed to update roommate status:', statusError.message);
    }

    const transaction = {
      id: commissionRecord.id,
      type: commissionRecord.status,
      direction: 'credit',
      amountNg: commission,
      roommateName: roommate.full_name,
      roommateLocation: roommate.preferred_locations,
      description: `Commission from referral ${referralCode}`,
      reference,
      createdAt: commissionRecord.created_at,
      paidAt: commissionRecord.paid_at,
    };

    return {
      paymentLink,
      commission,
      transaction,
      authorizationUrl: initialized.authorizationUrl,
      matchedRoommate: {
        id: matchedRoommateProfileId,
        fullName: matchedRoommate?.full_name ?? null,
      },
      matchId: match.id,
    };
  }

  /**
   * Processes a Paystack webhook event. Flips a pending commission to paid
   * on a successful charge. Idempotent on the Paystack reference.
   */
  async handleWebhookEvent(rawBody: string, signature: string | undefined) {
    if (!paystackService.verifyWebhookSignature(rawBody, signature)) {
      throw new HttpError(401, 'Invalid webhook signature');
    }

    const event = JSON.parse(rawBody);
    if (event?.event !== 'charge.success') {
      console.log('[webhook] ignored non-charge-success event:', event?.event);
      return { handled: false };
    }

    const reference = event?.data?.reference;
    if (!reference) {
      console.log('[webhook] missing reference in payload');
      return { handled: false };
    }

    const { data: commission, error: commissionError } = await supabase
      .from('commission_earnings')
      .select('*')
      .eq('paystack_reference', reference)
      .maybeSingle();

    if (commissionError) {
      throw new HttpError(500, `Failed to look up commission: ${commissionError.message}`);
    }

    // Idempotency: nothing to do if there's no matching commission or it's already paid.
    if (!commission || commission.status === 'paid') {
      console.log('[webhook] no pending commission for reference:', reference);
      return { handled: commission ? true : false, duplicate: commission?.status === 'paid' };
    }

    const now = new Date().toISOString();

    const { error: updateError } = await supabase
      .from('commission_earnings')
      .update({ status: 'paid', paid_at: now })
      .eq('id', commission.id);

    if (updateError) {
      throw new HttpError(500, `Failed to mark commission as paid: ${updateError.message}`);
    }

    const { data: ambassador } = await supabase
      .from('ambassador_profiles')
      .select('id, pending_balance_ngn, total_earnings_ngn, available_balance_ngn')
      .eq('user_id', commission.ambassador_user_id)
      .single();

    if (ambassador) {
      await supabase
        .from('ambassador_profiles')
        .update({
          pending_balance_ngn: Math.max(0, ambassador.pending_balance_ngn - commission.amount_ngn),
          total_earnings_ngn: ambassador.total_earnings_ngn + commission.amount_ngn,
          available_balance_ngn: ambassador.available_balance_ngn + commission.amount_ngn,
        })
        .eq('id', ambassador.id);
    }

    await supabase
      .from('payment_links')
      .update({ status: 'paid', paid_at: now })
      .eq('paystack_reference', reference);

    return { handled: true, commission };
  }

  /**
   * Returns the ambassador's payment summary. Values are derived from the
   * ledger (authoritative) rather than the denormalized profile columns.
   */
  async getSummary(userId: string) {
    const [pendingRes, paidRes, withdrawnRes] = await Promise.all([
      supabase
        .from('commission_earnings')
        .select('amount_ngn')
        .eq('ambassador_user_id', userId)
        .eq('status', 'pending'),
      supabase
        .from('commission_earnings')
        .select('amount_ngn')
        .eq('ambassador_user_id', userId)
        .eq('status', 'paid'),
      supabase
        .from('withdrawals')
        .select('amount_ngn')
        .eq('ambassador_user_id', userId),
    ]);

    const pendingPayments =
      pendingRes.data?.reduce((s, r) => s + Number(r.amount_ngn), 0) ?? 0;
    const totalEarned =
      paidRes.data?.reduce((s, r) => s + Number(r.amount_ngn), 0) ?? 0;
    const totalWithdrawn =
      withdrawnRes.data?.reduce((s, r) => s + Number(r.amount_ngn), 0) ?? 0;

    const availableBalance = Math.max(0, totalEarned - totalWithdrawn);

    return {
      pendingPayments,
      totalEarned,
      availableBalance,
      totalWithdrawn,
      successfulPayments: paidRes.data?.length ?? 0,
      commissionPercent: COMMISSION_PERCENT,
    };
  }

  /**
   * Returns the ambassador's recent transaction history. Commissions appear
   * as 'paid' or 'pending'; withdrawals appear as 'withdrawal'. Newest first.
   */
  async getTransactions(
    userId: string,
    opts: { type?: 'paid' | 'pending' | 'withdrawal'; limit: number; offset: number },
  ) {
    const { type, limit, offset } = opts;
    const transactions: Record<string, unknown>[] = [];

    if (!type || type === 'paid' || type === 'pending') {
      let query = supabase
        .from('commission_earnings')
        .select('id, amount_ngn, status, referral_code, paystack_reference, created_at, paid_at, roommate_profiles(full_name, preferred_locations)')
        .eq('ambassador_user_id', userId);

      if (type) {
        query = query.eq('status', type);
      }

      const { data, error } = await query;
      if (error) {
        throw new HttpError(500, `Failed to fetch commissions: ${error.message}`);
      }
      for (const c of data ?? []) {
        const roommateRow = c.roommate_profiles as unknown as
          | { full_name?: string; preferred_locations?: string[] }
          | Array<{ full_name?: string; preferred_locations?: string[] }>;
        const roommate = Array.isArray(roommateRow) ? roommateRow[0] : roommateRow;
        transactions.push({
          id: c.id,
          type: c.status,
          direction: 'credit',
          amountNg: c.amount_ngn,
          roommateName: roommate?.full_name,
          roommateLocation: roommate?.preferred_locations,
          description: `Commission from referral ${c.referral_code}`,
          reference: c.paystack_reference,
          createdAt: c.created_at,
          paidAt: c.paid_at,
        });
      }
    }

    if (!type || type === 'withdrawal') {
      const { data, error } = await supabase
        .from('withdrawals')
        .select('*')
        .eq('ambassador_user_id', userId);
      if (error) {
        throw new HttpError(500, `Failed to fetch withdrawals: ${error.message}`);
      }
      for (const w of data ?? []) {
        transactions.push({
          id: w.id,
          type: 'withdrawal',
          direction: 'debit',
          amountNg: w.amount_ngn,
          roommateName: null,
          roommateLocation: null,
          description: `Withdrawal to ${w.bank_name ?? 'bank'}`,
          status: w.status,
          reference: w.reference,
          createdAt: w.created_at,
        });
      }
    }

    transactions.sort(
      (a, b) =>
        new Date((b.createdAt as string) ?? 0).getTime() -
        new Date((a.createdAt as string) ?? 0).getTime(),
    );

    return {
      count: transactions.length,
      transactions: transactions.slice(offset, offset + limit),
    };
  }

  /**
   * Requests a payout from the ambassador's available balance to their saved
   * bank account via Paystack. Deducts the balance and records a withdrawal.
   */
  async requestWithdrawal(userId: string, input: RequestWithdrawalInput) {
    const { amountNg } = input;

    if (amountNg < MIN_WITHDRAWAL_AMOUNT) {
      throw new HttpError(
        400,
        `Minimum withdrawal is NGN ${MIN_WITHDRAWAL_AMOUNT}`,
      );
    }

    const { data: ambassador, error: profileError } = await supabase
      .from('ambassador_profiles')
      .select('id, bank_code, bank_name, account_number, account_name, available_balance_ngn, total_withdrawn_ngn')
      .eq('user_id', userId)
      .single();

    if (profileError || !ambassador) {
      throw new HttpError(404, 'Ambassador profile not found');
    }

    if (
      !ambassador.bank_code ||
      !ambassador.account_number ||
      !ambassador.account_name
    ) {
      throw new HttpError(
        400,
        'Bank details must be set before requesting a withdrawal',
      );
    }

    if (amountNg > ambassador.available_balance_ngn) {
      throw new HttpError(400, 'Insufficient available balance');
    }

    const recipient = await paystackService.createTransferRecipient({
      name: ambassador.account_name,
      accountNumber: resolveAccountNumber(ambassador.account_number),
      bankCode: resolveBankCode(ambassador.bank_code),
    });

    const reference = randomUUID();
    const transfer = await paystackService.initiateTransfer({
      amountKobo: nairaToKobo(amountNg),
      recipientCode: recipient.recipientCode,
      reference,
    });

    const { data: withdrawal, error: insertError } = await supabase
      .from('withdrawals')
      .insert({
        ambassador_user_id: userId,
        amount_ngn: amountNg,
        status: 'pending',
        bank_code: ambassador.bank_code,
        bank_name: ambassador.bank_name,
        account_number: ambassador.account_number,
        account_name: ambassador.account_name,
        paystack_recipient_code: recipient.recipientCode,
        paystack_transfer_code: transfer.transferCode,
        reference: transfer.reference,
      })
      .select('*')
      .single();

    if (insertError || !withdrawal) {
      throw new HttpError(
        500,
        `Failed to record withdrawal: ${insertError?.message ?? 'unknown error'}`,
      );
    }

    const { error: balanceError } = await supabase
      .from('ambassador_profiles')
      .update({
        available_balance_ngn: ambassador.available_balance_ngn - amountNg,
        total_withdrawn_ngn: ambassador.total_withdrawn_ngn + amountNg,
      })
      .eq('id', ambassador.id);

    if (balanceError) {
      console.error('Failed to update balance after withdrawal:', balanceError.message);
    }

    return withdrawal;
  }
}

export const paymentService = new PaymentService();
