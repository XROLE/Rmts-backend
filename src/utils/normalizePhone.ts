/**
 * Normalizes a Nigerian phone number to E.164 format required by the
 * WhatsApp Business Cloud API (e.g. +2348131234567).
 *
 * Accepts: 08131234567, +2348131234567, 2348131234567.
 * Returns null when the number cannot be parsed into a valid Nigerian number.
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
