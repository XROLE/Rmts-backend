import { z } from 'zod';

export const createPaymentLinkSchema = z.object({
  body: z.object({
    roommateProfileId: z.string().uuid('A valid roommate profile ID is required'),
    amountNg: z.number().positive('Amount must be positive'),
  }),
});

export const requestWithdrawalSchema = z.object({
  body: z.object({
    amountNg: z
      .number()
      .positive('Amount must be positive')
      .refine(
        (val) => Number.isInteger(val),
        'Amount must be a whole number of Naira',
      ),
  }),
});

export const getTransactionsSchema = z.object({
  query: z.object({
    type: z.enum(['paid', 'pending', 'withdrawal']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  }),
});

export const confirmWithdrawalSchema = z.object({
  params: z.object({
    id: z.string().uuid('A valid withdrawal ID is required'),
  }),
  body: z.object({
    action: z.enum(['approve', 'reject'], {
      errorMap: () => ({ message: "Action must be 'approve' or 'reject'" }),
    }),
  }),
});

export type CreatePaymentLinkInput = z.infer<
  typeof createPaymentLinkSchema
>['body'];

export type RequestWithdrawalInput = z.infer<
  typeof requestWithdrawalSchema
>['body'];

export type GetTransactionsInput = z.infer<
  typeof getTransactionsSchema
>['query'];

export type ConfirmWithdrawalInput = z.infer<
  typeof confirmWithdrawalSchema
>['body'];
