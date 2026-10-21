import { HttpError } from '../middleware/errorHandler.js';
import { supabase } from '../config/supabase.js';
import {
  normalizeAnyPhoneToE164,
  normalizePhoneToE164,
} from '../utils/normalizePhone.js';
import { whatsappLifecycleService } from './whatsappLifecycle.service.js';

export interface CreateMonthlyRequestPayload {
  name: string;
  phoneNumber: string;
  email?: string;
  gender: 'male' | 'female' | 'no_preference';
  state: string;
  preferredLocation: string;
  budgetMin: number;
  budgetMax: number;
  moveInDate: string;
}

const SELECT =
  'id, name, phone_number, email, gender, state, preferred_location, budget_min, budget_max, move_in_date, confirmed_at, notified_at, payment_reference, payment_link_created_at, paid_at, declined_at, created_at, updated_at';

/**
 * Stores a request for a monthly paid / shared apartment and kicks off the
 * WhatsApp confirmation from Sido. Fire-and-forget for the messaging so a
 * send failure never blocks the request. No matching is performed.
 */
export class MonthlyRequestService {
  async create(payload: CreateMonthlyRequestPayload) {
    const { data, error } = await supabase
      .from('monthly_apartment_requests')
      .insert({
        name: payload.name.trim(),
        phone_number: payload.phoneNumber,
        email: payload.email,
        gender: payload.gender,
        state: payload.state.trim(),
        preferred_location: payload.preferredLocation.trim(),
        budget_min: payload.budgetMin,
        budget_max: payload.budgetMax,
        move_in_date: payload.moveInDate,
      })
      .select(SELECT)
      .single();

    if (error) {
      throw new HttpError(
        500,
        `Failed to create monthly request: ${error.message}`,
      );
    }

    void whatsappLifecycleService
      .sendMonthlyRequestConfirmation(data as MonthlyRequestRecord)
      .then((sent) =>
        console.log(`[monthly-request] confirmation ${sent ? 'sent' : 'skipped'}`),
      )
      .catch((err) =>
        console.error('[monthly-request] confirmation failed:', err),
      );

    return data;
  }

  /**
   * Admin action: notifies everyone who requested a monthly shared space in
   * the given state + area and hasn't been notified yet. Returns the count
   * of requests that received the notification.
   */
  async notifyByArea(state: string, preferredLocation: string) {
    const targetState = state.trim().toLowerCase();
    const targetLocation = preferredLocation.trim().toLowerCase();

    const { data: requests, error } = await supabase
      .from('monthly_apartment_requests')
      .select(SELECT)
      .is('notified_at', null);

    if (error) {
      throw new HttpError(
        500,
        `Failed to fetch monthly requests: ${error.message}`,
      );
    }

    const matches = (requests ?? []).filter((r) => {
      const rState = (r.state ?? '').trim().toLowerCase();
      const rLoc = (r.preferred_location ?? '').trim().toLowerCase();
      return rState === targetState && rLoc === targetLocation;
    });

    let notified = 0;
    for (const req of matches) {
      const sent = await whatsappLifecycleService
        .sendMonthlySpaceAvailable(req as MonthlyRequestRecord)
        .catch((err) => {
          console.error('[monthly-request] notify failed:', err);
          return false;
        });
      if (!sent) continue;

      const { error: updateError } = await supabase
        .from('monthly_apartment_requests')
        .update({ notified_at: new Date().toISOString() })
        .eq('id', req.id);
      if (updateError) {
        console.error(
          '[monthly-request] failed to mark notified:',
          updateError.message,
        );
        continue;
      }
      notified += 1;
    }

    return { notified, total: matches.length };
  }
}

export interface MonthlyRequestRecord {
  id: string;
  name: string;
  phone_number: string;
  email?: string | null;
  gender: 'male' | 'female' | 'no_preference';
  state: string;
  preferred_location: string;
  budget_min: number;
  budget_max: number;
  move_in_date: string;
  confirmed_at?: string | null;
  notified_at?: string | null;
  payment_reference?: string | null;
  payment_link_created_at?: string | null;
  paid_at?: string | null;
  declined_at?: string | null;
  created_at: string;
  updated_at: string;
}

export const monthlyRequestService = new MonthlyRequestService();

// Re-export so callers can normalize recipient phones consistently.
export { normalizePhoneToE164, normalizeAnyPhoneToE164 };
