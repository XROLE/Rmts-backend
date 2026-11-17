import { z } from 'zod';

export const coRentingMatchingStatusSchema = z.enum([
  'active-search',
  'pending-match',
  'matched',
]);

/**
 * PATCH /co-renting/interest — a registered user records their co-renting
 * interest on their own roommate profile. All details are required so the
 * co-renters directory can show a meaningful listing. Matching status is
 * managed by the system/admin and is not accepted here.
 */
export const setCoRentingInterestSchema = z.object({
  body: z.object({
    isCoRenting: z.boolean({
      errorMap: () => ({ message: 'isCoRenting (boolean) is required' }),
    }),
    tribe: z.string().trim().min(1, 'Tribe is required').max(100),
    idealFlatmateDescription: z
      .string()
      .trim()
      .min(1, 'Ideal flatmate description is required')
      .max(2000),
    userBio: z.string().trim().min(1, 'User bio is required').max(5000),
  }),
});

/**
 * GET /co-renting/renters — paginated directory of registered co-renters.
 */
export const getCoRentersSchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
    matchingStatus: coRentingMatchingStatusSchema.optional(),
    token: z.string().optional(),
    name: z.string().optional(),
  }),
});

/**
 * PATCH /co-renting/:id/matching-status — admin transitions a co-renter
 * between the three matching states.
 */
export const updateCoRentingStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid('A valid profile id (uuid) is required'),
  }),
  body: z.object({
    matchingStatus: coRentingMatchingStatusSchema,
  }),
});

export type SetCoRentingInterestInput = z.infer<
  typeof setCoRentingInterestSchema
>['body'];
export type GetCoRentersInput = z.infer<typeof getCoRentersSchema>['query'];
export type UpdateCoRentingStatusInput = z.infer<
  typeof updateCoRentingStatusSchema
>;
export type CoRentingMatchingStatus = z.infer<
  typeof coRentingMatchingStatusSchema
>;
