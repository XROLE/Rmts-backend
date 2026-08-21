import { z } from 'zod';

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

export const startHandoverSchema = z.object({
  params: z.object({
    matchId: z.string().uuid('A valid match ID is required'),
  }),
});

export type StartHandoverInput = z.infer<typeof startHandoverSchema>['params'];
