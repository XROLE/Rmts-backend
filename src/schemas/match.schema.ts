import { z } from 'zod';

export const getMatchesSchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
    state: z.string().trim().min(1).optional(),
  }),
});

export const createMatchSchema = z.object({
  body: z
    .object({
      roommateProfileAId: z.string().uuid('A valid roommate profile ID is required'),
      roommateProfileBId: z.string().uuid('A valid roommate profile ID is required'),
      force: z.boolean().optional(),
    })
    .refine((val) => val.roommateProfileAId !== val.roommateProfileBId, {
      message: 'A profile cannot be matched with itself',
    }),
});

export const matchableProfileSchema = z
  .object({
    gender: z.string().trim().min(1).nullable().optional(),
    state: z.string().trim().min(1).nullable().optional(),
    religion: z.string().trim().min(1).nullable().optional(),
    preferredLocations: z.array(z.string()).nullable().optional(),
    budgetMin: z.number().nullable().optional(),
    budgetMax: z.number().nullable().optional(),
    expectedMoveInDate: z.string().trim().min(1).nullable().optional(),
    occupation: z.string().trim().min(1).nullable().optional(),
    smokingHabit: z.string().trim().min(1).nullable().optional(),
    allowsPets: z.boolean().nullable().optional(),
  })
  .strict();

export const computeMatchSchema = z.object({
  body: z.object({
    personA: matchableProfileSchema,
    personB: matchableProfileSchema,
  }),
});

export type CreateMatchInput = z.infer<typeof createMatchSchema>['body'];
