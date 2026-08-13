import { z } from 'zod';

const VERIFICATION_CHANNELS = ['email', 'whatsapp'] as const;

const channelSchema = z.enum(VERIFICATION_CHANNELS, {
  errorMap: () => ({ message: 'channel must be either "email" or "whatsapp"' }),
});

export const initiateVerificationSchema = z.object({
  body: z.object({
    channel: channelSchema,
  }),
});

export const confirmVerificationSchema = z.object({
  body: z.object({
    channel: channelSchema,
    code: z
      .string()
      .regex(/^\d{6}$/, 'Verification code must be a 6-digit number'),
  }),
});

export type VerificationChannel = z.infer<typeof channelSchema>;

export type InitiateVerificationInput = z.infer<
  typeof initiateVerificationSchema
>['body'];

export type ConfirmVerificationInput = z.infer<
  typeof confirmVerificationSchema
>['body'];