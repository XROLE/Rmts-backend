import { z } from 'zod';

const NIGERIAN_PHONE_REGEX = /^(?:\+?234|0)[789][01]\d{8}$/;

export const registerAmbassadorSchema = z.object({
  body: z.object({
    fullName: z.string().min(1, 'Full name is required').max(100),
    email: z.string().email('A valid email is required'),
    whatsappNumber: z.string().regex(
      NIGERIAN_PHONE_REGEX,
      'WhatsApp number must be a valid Nigerian phone number (e.g. 08131234567 or +2348131234567)',
    ),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(72, 'Password must be at most 72 characters'),
  }),
});

export const loginAmbassadorSchema = z.object({
  body: z.object({
    email: z.string().email('A valid email is required'),
    password: z.string().min(1, 'Password is required'),
  }),
});

export type RegisterAmbassadorInput = z.infer<
  typeof registerAmbassadorSchema
>['body'];

export type LoginAmbassadorInput = z.infer<
  typeof loginAmbassadorSchema
>['body'];