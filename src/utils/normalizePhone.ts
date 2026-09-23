/**
 * Converts a raw phone string to Nigerian E.164 (e.g. +2348131234567).
 *
 * Accepts: 08131234567, +2348131234567, 2348131234567.
 * Returns null when the number cannot be parsed into a valid Nigerian number.
 * Use normalizeAnyPhoneToE164 when non-Nigerian numbers must be accepted.
 */
export function normalizePhoneToE164(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');

  let national: string;
  if (digits.startsWith('234')) {
    national = digits.slice(3);
  } else if (digits.startsWith('0')) {
    national = digits.slice(1);
  } else {
    return null;
  }

  if (!/^[789][01]\d{8}$/.test(national)) return null;

  return `+234${national}`;
}

/**
 * Normalizes any phone number to E.164. Nigerian numbers keep the strict
 * +234 form; every other number is treated as a generic international number
 * (10-15 digits per the E.164 limit, leading "00" and "+" accepted).
 * Returns null when the input is not a plausible phone number.
 */
export function normalizeAnyPhoneToE164(phone: string): string | null {
  const nigerian = normalizePhoneToE164(phone);
  if (nigerian) return nigerian;

  const digits = phone.replace(/\D/g, '').replace(/^00/, '');
  if (digits.length < 10 || digits.length > 15) return null;

  return `+${digits}`;
}

/**
 * Matches a plausible UK number: either a national format (0 + 10 digits,
 * e.g. 07123456789 or 02079460000) or an international +44/44 format
 * (+44 + 10 digits, e.g. +447123456789).
 */
export const UK_PHONE_REGEX = /^(?:\+?44\d{10}|0\d{10})$/;

/** Matches a valid Nigerian number (e.g. 08131234567 or +2348131234567). */
export const NIGERIAN_PHONE_REGEX = /^(?:\+?234|0)[789][01]\d{8}$/;

/** Matches a valid Nigerian or UK phone number. */
export const SUPPORTED_PHONE_REGEX = /^(?:(?:\+?234|0)[789][01]\d{8}|(?:\+?44\d{10}|0\d{10}))$/;

/** Returns true when the phone is a valid Nigerian or UK number. */
export function isSupportedPhone(phone: string): boolean {
  return NIGERIAN_PHONE_REGEX.test(phone) || UK_PHONE_REGEX.test(phone);
}

/**
 * Builds the storage variants for a normalized E.164 phone so database
 * lookups match any serialization of the same number (+44/+234, bare digits,
 * or the leading-zero national form). Handles both Nigerian (234) and UK (44)
 * country codes.
 */
export function phoneLookupVariants(phoneE164: string): string[] {
  const digits = phoneE164.replace(/\D/g, '');

  let national = digits;
  if (national.startsWith('0')) national = national.slice(1);
  if (national.startsWith('234') && national.length === 13) {
    national = national.slice(3);
  } else if (national.startsWith('44') && national.length === 12) {
    national = national.slice(2);
  }

  const variants = [phoneE164, digits];
  if (national && national.length > 0) {
    variants.push(`0${national}`);
    variants.push(national);
  }
  return [...new Set(variants)];
}