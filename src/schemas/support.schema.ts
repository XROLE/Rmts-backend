import { z } from 'zod';

export const createSupportTicketSchema = z.object({
  body: z.object({
    title: z
      .string()
      .trim()
      .min(1, 'Title is required')
      .max(150, 'Title must be 150 characters or fewer'),
    message: z
      .string()
      .trim()
      .min(1, 'Message is required')
      .max(10000, 'Message must be 10,000 characters or fewer'),
  }),
});

export type CreateSupportTicketInput = z.infer<
  typeof createSupportTicketSchema
>['body'];
