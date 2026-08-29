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