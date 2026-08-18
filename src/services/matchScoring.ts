export const WEIGHTS = {
  location: 35,
  budget: 35,
  moveIn: 10,
  religion: 5,
  occupation: 5,
  smoking: 5,
  pets: 5,
} as const;

export interface MatchableProfile {
  religion?: string | null;
  preferredLocations?: string[] | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  expectedMoveInDate?: string | null;
  occupation?: string | null;
  smokingHabit?: string | null;
  allowsPets?: boolean | null;
}

export interface MatchBreakdown {
  location: number;
  budget: number;
  moveIn: number;
  religion: number;
  occupation: number;
  smoking: number;
  pets: number;
}

function shareAtLeastOne(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  const as = new Set(a ?? []);
  return (b ?? []).some((item) => as.has(item));
}

function locationOverlap(a: MatchableProfile, b: MatchableProfile): number {
  return shareAtLeastOne(a.preferredLocations, b.preferredLocations)
    ? WEIGHTS.location
    : 0;
}

function budgetOverlap(a: MatchableProfile, b: MatchableProfile): number {
  const aMin = a.budgetMin ?? 0;
  const aMax = a.budgetMax ?? 0;
  const bMin = b.budgetMin ?? 0;
  const bMax = b.budgetMax ?? 0;

  const smallRange = Math.min(aMax - aMin, bMax - bMin);
  if (smallRange <= 0) return 0;

  const overlap = Math.max(0, Math.min(aMax, bMax) - Math.max(aMin, bMin));
  const ratio = Math.min(1, overlap / smallRange);

  return Math.round(WEIGHTS.budget * ratio * 100) / 100;
}

function moveInProximity(a: MatchableProfile, b: MatchableProfile): number {
  if (!a.expectedMoveInDate || !b.expectedMoveInDate) return 0;

  const diffDays = Math.abs(
    new Date(a.expectedMoveInDate).getTime() -
      new Date(b.expectedMoveInDate).getTime(),
  ) / 86_400_000;

  if (!Number.isFinite(diffDays)) return 0;
  if (diffDays > 60) return 0;

  const ratio = Math.min(1, Math.max(0, (60 - diffDays) / (60 - 7)));
  return Math.round(WEIGHTS.moveIn * ratio * 100) / 100;
}

function religionMatch(a: MatchableProfile, b: MatchableProfile): number {
  if (a.religion && b.religion && a.religion === b.religion) return WEIGHTS.religion;
  if (!a.religion || !b.religion) return WEIGHTS.religion / 2;
  return 0;
}

function occupationMatch(a: MatchableProfile, b: MatchableProfile): number {
  return a.occupation && b.occupation && a.occupation === b.occupation
    ? WEIGHTS.occupation
    : 0;
}

function smokingMatch(a: MatchableProfile, b: MatchableProfile): number {
  if (a.smokingHabit && b.smokingHabit && a.smokingHabit === b.smokingHabit) {
    return WEIGHTS.smoking;
  }
  if (
    (a.smokingHabit === 'non_smoker' && b.smokingHabit === 'occasional_smoker') ||
    (a.smokingHabit === 'occasional_smoker' && b.smokingHabit === 'non_smoker')
  ) {
    return WEIGHTS.smoking / 2;
  }
  return 0;
}

function petsMatch(a: MatchableProfile, b: MatchableProfile): number {
  if (a.allowsPets == null || b.allowsPets == null) return WEIGHTS.pets / 2;
  return a.allowsPets === b.allowsPets ? WEIGHTS.pets : 0;
}

export function computeMatchScore(
  a: MatchableProfile,
  b: MatchableProfile,
): { score: number; breakdown: MatchBreakdown } {
  const breakdown: MatchBreakdown = {
    location: locationOverlap(a, b),
    budget: budgetOverlap(a, b),
    moveIn: moveInProximity(a, b),
    religion: religionMatch(a, b),
    occupation: occupationMatch(a, b),
    smoking: smokingMatch(a, b),
    pets: petsMatch(a, b),
  };

  const score = Math.round(
    Object.values(breakdown).reduce((sum, value) => sum + value, 0) * 100,
  ) / 100;

  return { score, breakdown };
}
