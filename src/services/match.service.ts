import { HttpError } from '../middleware/errorHandler.js';
import { supabase } from '../config/supabase.js';
import { computeMatchScore, MatchBreakdown } from './matchScoring.js';

interface RoommateProfileRow {
  id: string;
  gender?: string | null;
  state?: string | null;
  religion?: string | null;
  preferred_locations?: string[] | null;
  budget_min?: number | null;
  budget_max?: number | null;
  expected_move_in_date?: string | null;
  occupation?: string | null;
  smoking_habit?: string | null;
  allows_pets?: boolean | null;
}

export interface MatchPair {
  score: number;
  breakdown: MatchBreakdown;
  profiles: Record<string, unknown>[];
}

export const PROFILE_SELECT =
  'id, full_name, phone_number, email, gender, age_range, state, marital_status, religion, preferred_locations, budget_min, budget_max, expected_move_in_date, occupation, smoking_habit, allows_pets, sleep_habit, personal_bio, referred_by_code, status, is_active, agreed_to_terms, created_at, updated_at';

function toMatchable(row: RoommateProfileRow) {
  return {
    gender: row.gender,
    state: row.state,
    religion: row.religion,
    preferredLocations: row.preferred_locations,
    budgetMin: row.budget_min,
    budgetMax: row.budget_max,
    expectedMoveInDate: row.expected_move_in_date,
    occupation: row.occupation,
    smokingHabit: row.smoking_habit,
    allowsPets: row.allows_pets,
  };
}

export class MatchService {
  /**
   * Computes a compatibility score for every unordered pair of active
   * roommate profiles, sorts them by score (desc), and returns a paginated
   * slice of pairs. All-pairs is computed in memory, so this is best suited
   * to a few hundred profiles.
   */
  async listMatches(limit: number, offset: number) {
    const { data, error } = await supabase
      .from('roommate_profiles')
      .select(PROFILE_SELECT)
      .eq('is_active', true);

    if (error) {
      throw new HttpError(500, `Failed to fetch profiles for matching: ${error.message}`);
    }

    const profiles = (data ?? []) as Array<
      RoommateProfileRow & Record<string, unknown>
    >;

    const pairs: MatchPair[] = [];

    for (let i = 0; i < profiles.length; i++) {
      for (let j = i + 1; j < profiles.length; j++) {
        const a = profiles[i];
        const b = profiles[j];
        const { score, breakdown } = computeMatchScore(toMatchable(a), toMatchable(b));
        pairs.push({ score, breakdown, profiles: [a, b] });
      }
    }

    pairs.sort((x, y) => y.score - x.score);

    return {
      pairs: pairs.slice(offset, offset + limit),
      total: pairs.length,
    };
  }
}

export const matchService = new MatchService();
