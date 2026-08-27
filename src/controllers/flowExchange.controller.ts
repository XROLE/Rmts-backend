import { Request, Response } from 'express';
import { whatsappLifecycleService } from '../services/whatsappLifecycle.service.js';

/** A minimal error payload type, as required by the Flows Data Exchange contract. */
type FlowError = { message: string };

/**
 * POST /api/v1/flows/endpoint — the WhatsApp Flows Data Exchange endpoint.
 *
 * Meta POSTs completed-flow submissions directly here (defined by the top-level
 * "endpoint" field in each flow JSON) with a body shaped like:
 *   { version, flow_id, flow_token, endpoint_request_id, data, ... }
 *
 * Unlike the webhook's nfm_reply, the request does NOT carry the sender phone,
 * so the flow_token is resolved to the originating phone via flow_sessions.
 *
 * Responds with the Data Exchange contract:
 *   { status: "success", data: {...} } | { status: "error", error: { message } }
 */
export async function flowExchange(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    if (typeof body !== 'object' || body === null) {
      return res.status(400).json(flowError('Invalid request body'));
    }

    const flowToken = typeof body.flow_token === 'string' ? body.flow_token : '';
    const data = (body.data ?? {}) as Record<string, unknown>;

    if (!flowToken) {
      return res.status(400).json(flowError('Missing flow_token'));
    }

    // Match decisions resolve entirely through the match's flow_token, so we can
    // handle them even before (or without) a phone lookup.
    if (typeof data.accept_match === 'string') {
      const result = await whatsappLifecycleService.handleMatchDecision(flowToken, data);
      return res.status(200).json(flowSuccess(result ?? {}));
    }

    const phone = await whatsappLifecycleService.getPhoneByFlowToken(flowToken);
    if (!phone) {
      return res
        .status(400)
        .json(flowError('Unable to attribute this submission to a user (unknown flow_token)'));
    }

    // Registration flow (payload carries flow: "registration").
    if (data.flow === 'registration') {
      const result = await whatsappLifecycleService.handleRegistrationResponse(phone, data);
      if (result.invalid) {
        return res.status(200).json(
          flowError('Sorry, we could not process your registration. Please try again.'),
        );
      }
      return res.status(200).json(flowSuccess(result ?? {}));
    }

    // Onboarding flow (carries proceed_decision).
    if (typeof data.proceed_decision === 'string') {
      const result = await whatsappLifecycleService.handleOnboardingResponse(phone, data);
      return res.status(200).json(flowSuccess(result ?? {}));
    }

    return res
      .status(200)
      .json(flowError('Unrecognized flow submission. Please start the flow again.'));
  } catch (err) {
    console.error('[flow-exchange] processing failed:', err);
    return res.status(200).json(
      flowError('Something went wrong processing this submission. Please try again.'),
    );
  }
}

function flowSuccess(data: Record<string, unknown>) {
  return { status: 'success', data };
}

function flowError(message: string): { status: 'error'; error: FlowError } {
  return { status: 'error', error: { message } };
}
