import { HttpError } from '../middleware/errorHandler.js';
import { supabase } from '../config/supabase.js';
import { computeMatchScore, isEligiblePair, MatchBreakdown } from './matchScoring.js';

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

export interface RoommateMatchRow {
  id: string;
  roommate_profile_a_id: string;
  roommate_profile_b_id: string;
  score: number | null;
  breakdown: MatchBreakdown | null;
  status: 'active' | 'closed';
  created_at: string;
  updated_at: string;
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
   * Computes a compatibility score for every unordered pair of new/rematch
   * roommate profiles, then builds a disjoint set of pairs where each user is
   * matched at most once (greedy by highest score). Returns a paginated slice
   * of those pairs. All scores are computed in memory, so this is best suited
   * to a few hundred profiles.
   */
  async listMatches(limit: number, offset: number) {
    const { data, error } = await supabase
      .from('roommate_profiles')
      .select(PROFILE_SELECT)
      .eq('is_active', true)
      .in('status', ['new', 'rematch']);

    if (error) {
      throw new HttpError(500, `Failed to fetch profiles for matching: ${error.message}`);
    }

    const profiles = (data ?? []) as Array<
      RoommateProfileRow & Record<string, unknown>
    >;

    const candidates: { score: number; breakdown: MatchBreakdown; a: number; b: number }[] = [];

    for (let i = 0; i < profiles.length; i++) {
      for (let j = i + 1; j < profiles.length; j++) {
        const a = profiles[i];
        const b = profiles[j];
        const matchA = toMatchable(a);
        const matchB = toMatchable(b);
        if (!isEligiblePair(matchA, matchB)) continue;
        const { score, breakdown } = computeMatchScore(matchA, matchB);
        candidates.push({ score, breakdown, a: i, b: j });
      }
    }

    candidates.sort((x, y) => y.score - x.score);

    const taken = new Set<number>();
    const pairs: MatchPair[] = [];

    for (const candidate of candidates) {
      if (taken.has(candidate.a) || taken.has(candidate.b)) continue;
      taken.add(candidate.a);
      taken.add(candidate.b);
      pairs.push({
        score: candidate.score,
        breakdown: candidate.breakdown,
        profiles: [profiles[candidate.a], profiles[candidate.b]],
      });
    }

    return {
      pairs: pairs.slice(offset, offset + limit),
      total: pairs.length,
    };
  }

  /**
   * Persists an admin-confirmed match between two profiles. Both profiles
   * must be active, available for matching (status 'new' or 'rematch') and
   * free of any other active match. The pair is stored with ordered ids
   * (a < b) so it stays unique, and both profiles move to 'matched'.
   */
  async confirmMatch(profileAId: string, profileBId: string) {
    const { data, error } = await supabase
      .from('roommate_profiles')
      .select(PROFILE_SELECT)
      .in('id', [profileAId, profileBId]);

    if (error) {
      throw new HttpError(500, `Failed to fetch profiles: ${error.message}`);
    }

    const profileA = data?.find((p) => p.id === profileAId);
    const profileB = data?.find((p) => p.id === profileBId);

    if (!profileA || !profileB) {
      throw new HttpError(404, 'One or both roommate profiles not found');
    }

    for (const profile of [profileA, profileB]) {
      if (!profile.is_active || !['new', 'rematch'].includes(String(profile.status))) {
        throw new HttpError(
          409,
          `Profile ${profile.id} is not available for matching (status: ${profile.status})`,
        );
      }
    }

    const [aId, bId] = [profileAId, profileBId].sort();

    const { data: existing } = await supabase
      .from('roommate_matches')
      .select('id')
      .eq('status', 'active')
      .or(
        `roommate_profile_a_id.in.(${profileAId},${profileBId}),` +
          `roommate_profile_b_id.in.(${profileAId},${profileBId})`,
      )
      .limit(1)
      .maybeSingle();

    if (existing) {
      throw new HttpError(409, 'One or both profiles already have an active match');
    }

    const matchA = toMatchable(profileA);
    const matchB = toMatchable(profileB);
    if (!isEligiblePair(matchA, matchB)) {
      throw new HttpError(400, 'These profiles are not eligible to be matched');
    }

    const { score, breakdown } = computeMatchScore(matchA, matchB);

    const { data: match, error: matchError } = await supabase
      .from('roommate_matches')
      .insert({
        roommate_profile_a_id: aId,
        roommate_profile_b_id: bId,
        score,
        breakdown,
        status: 'active',
      })
      .select('*')
      .single();

    if (matchError || !match) {
      throw new HttpError(500, `Failed to store match: ${matchError?.message}`);
    }

    const { error: statusError } = await supabase
      .from('roommate_profiles')
      .update({ status: 'matched' })
      .in('id', [profileAId, profileBId]);

    if (statusError) {
      console.error('Failed to mark profiles as matched:', statusError.message);
    }

    return {
      match: match as RoommateMatchRow,
      profiles: [profileA, profileB],
    };
  }

  /**
   * Returns the active match containing the given profile, or null when the
   * profile has no active match.
   */
  async getActiveMatchForProfile(profileId: string): Promise<RoommateMatchRow | null> {
    const { data, error } = await supabase
      .from('roommate_matches')
      .select('*')
      .eq('status', 'active')
      .or(`roommate_profile_a_id.eq.${profileId},roommate_profile_b_id.eq.${profileId}`)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Failed to look up match: ${error.message}`);
    }

    return (data as RoommateMatchRow | null) ?? null;
  }
}

export const matchService = new MatchService();
