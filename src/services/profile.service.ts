import { HttpError } from '../middleware/errorHandler.js';
import { supabase } from '../config/supabase.js';

export interface CreateProfilePayload {
  email: string;
  fullName: string;
  phoneNumber: string;
  gender: 'male' | 'female' | 'no_preference';
  ageRange: string;
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
  referredByCode?: string;
}

export class ProfileService {
  /**
   * Creates a roommate profile.
   * Registration is treated as a public self-service action with no auth user.
   */
  async create(payload: CreateProfilePayload) {
    const {
      email,
      fullName,
      phoneNumber,
      gender,
      ageRange,
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
      referredByCode,
    } = payload;

    const { data, error: insertError } = await supabase
      .from('roommate_profiles')
      .insert({
        full_name: fullName,
        phone_number: phoneNumber,
        email,
        gender,
        age_range: ageRange,
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
        referred_by_code: referredByCode,
      })
      .select(
        'id, full_name, gender, age_range, preferred_locations, budget_min, budget_max, expected_move_in_date, occupation, allows_pets, sleep_habit, personal_bio, referred_by_code, status, is_active, created_at, updated_at',
      )
      .single();

    if (insertError) {
      throw new HttpError(500, `Failed to create profile: ${insertError.message}`);
    }

    return data;
  }
}

export const profileService = new ProfileService();