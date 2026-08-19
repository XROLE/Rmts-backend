import { z } from 'zod';

export const getMatchesSchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  }),
});

export const createMatchSchema = z.object({
  body: z
    .object({
      roommateProfileAId: z.string().uuid('A valid roommate profile ID is required'),
      roommateProfileBId: z.string().uuid('A valid roommate profile ID is required'),
    })
    .refine((val) => val.roommateProfileAId !== val.roommateProfileBId, {
      message: 'A profile cannot be matched with itself',
    }),
});

export type CreateMatchInput = z.infer<typeof createMatchSchema>['body'];
