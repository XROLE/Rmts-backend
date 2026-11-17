import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../middleware/errorHandler.js';

const TOKEN_PURPOSE = 'co-renting-form';
const TTL_MS = Number(process.env.CO_RENTING_LINK_TTL_HOURS ?? 24) * 60 * 60 * 1000;

interface CoRentingLinkPayload {
  sub: string;
  purpose: string;
  exp: number;
}

function linkSecret(): string {
  const secret =
    process.env.CO_RENTING_LINK_SECRET ?? process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new HttpError(
      500,
      'CO_RENTING_LINK_SECRET (or SUPABASE_JWT_SECRET) is not configured',
    );
  }
  return secret;
}

function sign(encodedPayload: string): string {
  return createHmac('sha256', linkSecret()).update(encodedPayload).digest('base64url');
}

/**
 * Creates a short-lived, HMAC-signed token for a roommate profile id. It is
 * attached to the co-renting form link Sido sends, so a public form can submit
 * interest on behalf of that profile without a website login.
 */
export function createCoRentingLinkToken(profileId: string): string {
  const payload: CoRentingLinkPayload = {
    sub: profileId,
    purpose: TOKEN_PURPOSE,
    exp: Date.now() + TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

/**
 * Verifies a co-renting link token and returns the profile id it was issued
 * for. Rejects malformed, tampered, expired or wrong-purpose tokens with 401.
 */
export function verifyCoRentingLinkToken(token: string): { profileId: string } {
  const [encoded, signature, ...extra] = token.split('.');
  if (!encoded || !signature || extra.length > 0) {
    throw new HttpError(401, 'Invalid co-renting link token');
  }

  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new HttpError(401, 'Invalid co-renting link token');
  }

  let payload: CoRentingLinkPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as CoRentingLinkPayload;
  } catch {
    throw new HttpError(401, 'Invalid co-renting link token');
  }

  if (
    typeof payload.sub !== 'string' ||
    !payload.sub ||
    payload.purpose !== TOKEN_PURPOSE ||
    typeof payload.exp !== 'number' ||
    payload.exp <= Date.now()
  ) {
    throw new HttpError(401, 'Invalid or expired co-renting link token');
  }

  return { profileId: payload.sub };
}
