import { z } from 'zod';

const NIGERIAN_PHONE_REGEX = /^(?:\+?234|0)[789][01]\d{8}$/;

/**
 * Loose validation of the inbound Meta webhook payload. Message payloads are
 * deeply nested vendor JSON, so we only validate the fields we dispatch on and
 * pass the rest through untouched.
 */
export const whatsappWebhookBodySchema = z.object({
  body: z.object({
    object: z.string().optional(),
    entry: z
      .array(
        z.object({
          changes: z
            .array(
              z.object({
                value: z
                  .object({
                    messages: z
                      .array(
                        z.object({
                          from: z.string().optional(),
                          type: z.string().optional(),
                          interactive: z
                            .object({
                              type: z.string().optional(),
                              nfm_reply: z
                                .object({
                                  name: z.string().optional(),
                                  response_json: z.string().optional(),
                                })
                                .optional(),
                            })
                            .optional(),
                        }),
                      )
                      .optional(),
                  })
                  .optional(),
              }),
            )
            .optional(),
        }),
      )
      .optional(),
  }),
});

// POST /whatsapp/trigger-onboarding
export const triggerOnboardingSchema = z.object({
  body: z.object({
    phone: z.string().regex(
      NIGERIAN_PHONE_REGEX,
      'Phone must be a valid Nigerian number (e.g. 08131234567 or 2348131234567)',
    ),
    name: z.string().min(1, 'Name is required').max(100),
  }),
});

// POST /whatsapp/trigger-registration
export const triggerRegistrationSchema = z.object({
  body: z.object({
    phone: z.string().regex(
      NIGERIAN_PHONE_REGEX,
      'Phone must be a valid Nigerian number (e.g. 08131234567 or 2348131234567)',
    ),
    name: z.string().min(1, 'Name is required').max(100),
  }),
});

// POST /whatsapp/trigger-match
export const triggerMatchSchema = z.object({
  body: z.object({
    matchId: z.string().uuid('A valid match ID is required').optional(),
    userPhone: z.string().regex(
      NIGERIAN_PHONE_REGEX,
      'userPhone must be a valid Nigerian number (e.g. 2348012345678)',
    ),
    userName: z.string().min(1, 'userName is required').max(100),
    compatibilityScore: z.coerce.number().int().min(0).max(100),
    location: z.string().min(1, 'location is required').max(200),
    budget: z.number().min(0),
    moveInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
      message: 'moveInDate must be a YYYY-MM-DD date',
    }),
    candidateId: z.string().uuid('candidateId must be a UUID').optional(),
  }),
});
