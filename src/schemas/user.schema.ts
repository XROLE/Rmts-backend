import { z } from 'zod';

export const deleteUserSchema = z.object({
  params: z.object({
    id: z.string().uuid('A valid user ID is required'),
  }),
});

export type DeleteUserInput = z.infer<typeof deleteUserSchema>['params'];
