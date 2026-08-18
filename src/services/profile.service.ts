import { HttpError } from '../middleware/errorHandler.js';
import { supabase } from '../config/supabase.js';

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
        preferred_locations: preferredLocations,
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
        'id, full_name, gender, age_range, state, preferred_locations, budget_min, budget_max, expected_move_in_date, occupation, allows_pets, sleep_habit, personal_bio, referred_by_code, status, is_active, created_at, updated_at',
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