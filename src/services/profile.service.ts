import { HttpError } from '../middleware/errorHandler.js';
import { supabase } from '../config/supabase.js';
import type { UpdateProfileInput, SearchProfilesInput } from '../schemas/profile.schema.js';
import {
  normalizeAnyPhoneToE164,
  phoneLookupVariants,
} from '../utils/normalizePhone.js';

/**
 * Lifecycle states in which a request can no longer be edited by the user.
 * Editing is blocked once a match has been found or payment is in flight, to
 * avoid tampering with an active match. Allowed: new, reviewing, paused.
 */
/**
 * Quotes a value for use as a single element inside a PostgREST array literal
 * (e.g. `preferred_locations.cs.{...}`). Wrapping in double quotes keeps
 * elements with spaces or commas (e.g. "Ajah, Lagos") intact, and embedded
 * double quotes are escaped by doubling.
 */
function quoteArrayElement(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

const LOCKED_EDIT_STATUSES = [
  'potential_match_found',
  'waiting_approval',
  'payment_pending',
  'paid',
  'connected',
  'closed',
  'paused',
  'suspended',
] as const;

const EDITABLE_SELECT =
  'id, full_name, email, phone_number, gender, age_range, state, preferred_locations, budget_min, budget_max, expected_move_in_date, occupation, allows_pets, sleep_habit, personal_bio, referred_by_code, status, is_active, status_reason, paused_at, suspended_at, created_at, updated_at';

export interface CreateProfilePayload {
  email: string;
  fullName: string;
  phoneNumber: string;
  gender: 'male' | 'female' | 'no_preference';
  ageRange: string;
  state: string;
  maritalStatus?: 'single' | 'married' | 'divorced' | 'prefer_not_to_say';
  religion?: string;
  preferredLocations: string[];
  budgetMin: number;
  budgetMax: number;
  expectedMoveInDate: string;
  occupation: 'student' | 'nysc' | 'working_professional' | 'self_employed' | 'job_seeker';
  smokingHabit?: 'non_smoker' | 'occasional_smoker' | 'regular_smoker';
  allowsPets?: boolean;
  sleepHabit?: string;
  personalBio?: string;
  agreedToTerms: true;
}

export class ProfileService {
  /**
   * Creates a roommate profile.
   * Registration is treated as a public self-service action with no auth user.
   *
   * When a referral code is supplied it is matched against ambassador
   * referral codes. Unknown codes are silently ignored so registration
   * never fails because of a bad code.
   */
  async create(payload: CreateProfilePayload, referralCode?: string) {
    const {
      email,
      fullName,
      phoneNumber,
      gender,
      ageRange,
      state,
      maritalStatus = 'single',
      religion,
      preferredLocations,
      budgetMin,
      budgetMax,
      expectedMoveInDate,
      occupation,
      smokingHabit = 'non_smoker',
      allowsPets = false,
      sleepHabit,
      personalBio,
      agreedToTerms,
    } = payload;

    const ambassador = referralCode
      ? await this.findAmbassadorByReferralCode(referralCode)
      : null;

    const { data, error: insertError } = await supabase
      .from('roommate_profiles')
      .insert({
        full_name: fullName,
        phone_number: phoneNumber,
        email,
        gender,
        age_range: ageRange,
        state,
        marital_status: maritalStatus,
        religion,
        preferred_locations: Array.from(
        new Set(preferredLocations.map((l) => l.trim()).filter(Boolean)),
      ),
        budget_min: budgetMin,
        budget_max: budgetMax,
        expected_move_in_date: expectedMoveInDate,
        occupation,
        smoking_habit: smokingHabit,
        allows_pets: allowsPets,
        sleep_habit: sleepHabit,
        personal_bio: personalBio,
        agreed_to_terms: agreedToTerms,
        agreed_at: new Date().toISOString(),
        referred_by_code: ambassador ? ambassador.referral_code : undefined,
      })
      .select(
        'id, full_name, phone_number, gender, age_range, state, preferred_locations, budget_min, budget_max, expected_move_in_date, occupation, allows_pets, sleep_habit, personal_bio, referred_by_code, status, is_active, created_at, updated_at',
      )
      .single();

    if (insertError) {
      throw new HttpError(500, `Failed to create profile: ${insertError.message}`);
    }

    if (ambassador) {
      await this.incrementReferralCount(ambassador);
    }

    return data;
  }

  /**
   * Updates a roommate request identified by the owner's phone number.
   *
   * Ownership is established by the Sido/WhatsApp conversation: the caller
   * supplies the profile's phone number (the trusted WhatsApp sender), which is
   * matched against stored phone serializations. Only a limited subset of
   * fields is editable, and editing is blocked once a match/payment is in
   * flight. Returns the updated profile, or throws 404/409/400 as appropriate.
   */
  async updateByPhone(
    phoneNumber: string,
    updates: Omit<UpdateProfileInput, 'phoneNumber'>,
  ) {
    const normalized =
      normalizeAnyPhoneToE164(phoneNumber) ?? phoneNumber;
    const variants = phoneLookupVariants(normalized);

    const { data: profile, error: findError } = await supabase
      .from('roommate_profiles')
      .select('id, status, budget_min, budget_max')
      .in('phone_number', variants)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError) {
      throw new HttpError(500, `Failed to find profile: ${findError.message}`);
    }
    if (!profile) {
      throw new HttpError(404, 'No roommate request found for this phone number');
    }
    if (LOCKED_EDIT_STATUSES.includes(profile.status as never)) {
      throw new HttpError(
        409,
        'This request can no longer be edited because a match has been initiated',
      );
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (updates.preferredLocations) {
      patch.preferred_locations = Array.from(
        new Set(updates.preferredLocations.map((l) => l.trim()).filter(Boolean)),
      );
    }
    if (updates.budgetMin !== undefined) patch.budget_min = updates.budgetMin;
    if (updates.budgetMax !== undefined) patch.budget_max = updates.budgetMax;
    if (updates.expectedMoveInDate) {
      patch.expected_move_in_date = updates.expectedMoveInDate;
    }

    const mergedMin =
      patch.budget_min ?? (profile.budget_min as number | null) ?? 0;
    const mergedMax =
      patch.budget_max ?? (profile.budget_max as number | null) ?? 0;
    if (mergedMax < mergedMin) {
      throw new HttpError(
        400,
        'budgetMax must be greater than or equal to budgetMin',
      );
    }

    const { data, error: updateError } = await supabase
      .from('roommate_profiles')
      .update(patch)
      .eq('id', profile.id)
      .select(EDITABLE_SELECT)
      .single();

    if (updateError) {
      throw new HttpError(500, `Failed to update profile: ${updateError.message}`);
    }

    return data;
  }

  /**
   * Updates the lifecycle status of a roommate request by its primary id.
   *
   * `paused` and `suspended` stop the profile from being matched: we set
   * `is_active = false` and record the transition timestamp (`paused_at` /
   * `suspended_at`) plus an optional `status_reason`. `active` reactivates a
   * previously paused/suspended profile: we set `is_active = true` and clear
   * the pause/suspension audit fields so it re-enters the matching pool.
   * Returns the updated profile, or throws 404/500 as appropriate.
   */
  async updateStatus(
    id: string,
    status: 'paused' | 'suspended' | 'active',
    reason?: string,
  ) {
    const { data: existing, error: findError } = await supabase
      .from('roommate_profiles')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (findError) {
      throw new HttpError(500, `Failed to find profile: ${findError.message}`);
    }
    if (!existing) {
      throw new HttpError(404, 'No roommate profile found for the given id');
    }

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      status,
      updated_at: now,
    };

    if (status === 'active') {
      // Reactivation: return the profile to the matching pool, clearing any
      // prior pause/suspension audit data and reason.
      patch.is_active = true;
      patch.status_reason = null;
      patch.paused_at = null;
      patch.suspended_at = null;
    } else {
      // Pausing or suspending removes the profile from the matching pool and
      // records the transition timestamp (plus a reason for suspension).
      patch.is_active = false;
      patch.status_reason = reason ?? null;
      if (status === 'paused') {
        patch.paused_at = now;
      } else {
        patch.suspended_at = now;
      }
    }

    const { data, error: updateError } = await supabase
      .from('roommate_profiles')
      .update(patch)
      .eq('id', id)
      .select(EDITABLE_SELECT)
      .single();

    if (updateError) {
      throw new HttpError(
        500,
        `Failed to update profile status: ${updateError.message}`,
      );
    }

    return data;
  }

  /**
   * Returns admin dashboard profile metrics across the four lifecycle states:
   * all profiles, new (unmatched), pending payment, and fully connected (paid).
   * All values are exact head-counts against roommate_profiles.
   */
  async getDashboardStats() {
    const [totalRes, newRes, pendingPaymentRes, connectedRes] =
      await Promise.all([
        supabase
          .from('roommate_profiles')
          .select('id', { count: 'exact', head: true }),
        supabase
          .from('roommate_profiles')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'new'),
        supabase
          .from('roommate_profiles')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending_payment'),
        supabase
          .from('roommate_profiles')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'paid'),
      ]);

    if (totalRes.error) {
      throw new HttpError(500, `Failed to count profiles: ${totalRes.error.message}`);
    }
    if (newRes.error) {
      throw new HttpError(500, `Failed to count new profiles: ${newRes.error.message}`);
    }
    if (pendingPaymentRes.error) {
      throw new HttpError(
        500,
        `Failed to count pending payments: ${pendingPaymentRes.error.message}`,
      );
    }
    if (connectedRes.error) {
      throw new HttpError(
        500,
        `Failed to count connected profiles: ${connectedRes.error.message}`,
      );
    }

    return {
      totalProfiles: totalRes.count ?? 0,
      totalNewProfiles: newRes.count ?? 0,
      totalPendingPayments: pendingPaymentRes.count ?? 0,
      totalConnectedProfiles: connectedRes.count ?? 0,
    };
  }

  /**
   * Admin search over roommate profiles. `state` is required; all other
   * filters are optional and combined with AND.
   *
   * Filter semantics:
   *  - state: case-insensitive match
   *  - location: array-contains on preferred_locations
   *  - minBudget: profile budget_max >= minBudget (can afford at least this)
   *  - maxBudget: profile budget_min <= maxBudget (fits within the cap)
   *    -> together these yield range-overlap with [minBudget, maxBudget]
   *  - moveInDateFrom/To: inclusive date range on expected_move_in_date
   *  - status / gender: exact match
   *  - isActive: exact match (defaults to true when omitted)
   */
  async search(filters: SearchProfilesInput) {
    const select =
      'id, full_name, phone_number, email, gender, age_range, state, marital_status, religion, preferred_locations, budget_min, budget_max, expected_move_in_date, occupation, smoking_habit, allows_pets, sleep_habit, personal_bio, referred_by_code, status, is_active, agreed_to_terms, created_at, updated_at';

    const applyFilters = (q: any) => {
      q = q.ilike('state', filters.state);
      if (filters.location) {
        const locs = (Array.isArray(filters.location)
          ? filters.location
          : [filters.location]
        )
          .map((l) => `${l}`.trim())
          .filter(Boolean);
        if (locs.length) {
          const or = locs
            .map((l) => `preferred_locations.cs.{${quoteArrayElement(l)}}`)
            .join(',');
          q = q.or(or);
        }
      }
      if (filters.minBudget !== undefined) {
        q = q.gte('budget_max', filters.minBudget);
      }
      if (filters.maxBudget !== undefined) {
        q = q.lte('budget_min', filters.maxBudget);
      }
      if (filters.moveInDateFrom) {
        q = q.gte('expected_move_in_date', filters.moveInDateFrom);
      }
      if (filters.moveInDateTo) {
        q = q.lte('expected_move_in_date', filters.moveInDateTo);
      }
      if (filters.status) {
        q = q.eq('status', filters.status);
      }
      if (filters.gender) {
        q = q.eq('gender', filters.gender);
      }
      if (filters.isActive !== undefined) {
        q = q.eq('is_active', filters.isActive);
      }
      return q;
    };

    const { limit, offset } = filters;

    const [listResult, countResult] = await Promise.all([
      applyFilters(supabase.from('roommate_profiles').select(select))
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1),
      applyFilters(
        supabase.from('roommate_profiles').select('id', { count: 'exact', head: true }),
      ),
    ]);

    if (listResult.error) {
      throw new HttpError(500, `Failed to search profiles: ${listResult.error.message}`);
    }
    if (countResult.error) {
      throw new HttpError(500, `Failed to count profiles: ${countResult.error.message}`);
    }

    return {
      items: listResult.data ?? [],
      total: countResult.count ?? 0,
    };
  }

  /**
   * Returns all roommate profiles, newest first, paginated. Admin-only.
   */
  async listAll(limit: number, offset: number) {
    const select =
      'id, full_name, phone_number, email, gender, age_range, state, marital_status, religion, preferred_locations, budget_min, budget_max, expected_move_in_date, occupation, smoking_habit, allows_pets, sleep_habit, personal_bio, referred_by_code, status, is_active, agreed_to_terms, created_at, updated_at';

    const [listResult, countResult] = await Promise.all([
      supabase
        .from('roommate_profiles')
        .select(select)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1),
      supabase
        .from('roommate_profiles')
        .select('id', { count: 'exact', head: true }),
    ]);

    if (listResult.error) {
      throw new HttpError(500, `Failed to fetch users: ${listResult.error.message}`);
    }
    if (countResult.error) {
      throw new HttpError(500, `Failed to count users: ${countResult.error.message}`);
    }

    return {
      items: listResult.data ?? [],
      total: countResult.count ?? 0,
    };
  }

  /**
   * Looks up a single roommate profile by email or phone number. Exactly one
   * identifier must be provided by the caller (enforced at the schema layer).
   *
   * Phone is matched against every serialized form of the same number
   * (+234/0/bare digits) via phoneLookupVariants, so any stored format matches.
   * Email uses a case-insensitive match (roommate_profiles.email is optional).
   * Returns the full profile, or throws 404 when no match exists.
   */
  async getByLookup(opts: { email?: string; phoneNumber?: string }) {
    let query = supabase
      .from('roommate_profiles')
      .select(EDITABLE_SELECT)
      .limit(1);

    if (opts.phoneNumber) {
      const normalized =
        normalizeAnyPhoneToE164(opts.phoneNumber) ?? opts.phoneNumber;
      const variants = phoneLookupVariants(normalized);
      query = query.in('phone_number', variants);
    } else if (opts.email) {
      query = query.ilike('email', opts.email);
    } else {
      throw new HttpError(400, 'Provide either an email or a phoneNumber');
    }

    const { data: profile, error } = await query.maybeSingle();

    if (error) {
      throw new HttpError(500, `Failed to look up profile: ${error.message}`);
    }
    if (!profile) {
      throw new HttpError(404, 'No roommate profile found for the given details');
    }

    return profile;
  }

  /**
   * Resolves a referral code to its ambassador. Codes are stored uppercase,
   * so input is normalized before lookup. Returns null for unknown codes.
   */
  private async findAmbassadorByReferralCode(referralCode: string) {
    const { data, error } = await supabase
      .from('ambassador_profiles')
      .select('id, referral_code, total_referrals')
      .eq('referral_code', referralCode.toUpperCase())
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Failed to validate referral code: ${error.message}`);
    }

    return data;
  }

  /**
   * Bumps the ambassador's total_referrals counter. Failures are logged but
   * never block registration — referred_by_code on the profile is the
   * source of truth and the counter can be backfilled.
   */
  private async incrementReferralCount(ambassador: {
    id: string;
    total_referrals: number;
  }) {
    const { error } = await supabase
      .from('ambassador_profiles')
      .update({ total_referrals: ambassador.total_referrals + 1 })
      .eq('id', ambassador.id);

    if (error) {
      console.error('Failed to increment referral count:', error.message);
    }
  }
}

export const profileService = new ProfileService();