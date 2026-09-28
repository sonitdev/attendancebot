/**
 * Utility functions for E.164 phone number normalization and safe phone masking.
 */

/**
 * Normalizes an arbitrary phone string into a clean E.164 format.
 * Examples:
 * - "+855 12 345 678" -> "+85512345678"
 * - "+1 (555) 000-1234" -> "+15550001234"
 * - "012345678" -> "+85512345678" (defaulting local 0-prefix to +855 if unspecified)
 */
export function normalizePhone(rawPhone?: string | null): string | null {
  if (!rawPhone || typeof rawPhone !== 'string') return null;

  const trimmed = rawPhone.trim();
  if (!trimmed) return null;

  // Extract digits and leading '+'
  const hasLeadingPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  if (!digits || digits.length < 6) return null;

  if (hasLeadingPlus) {
    return `+${digits}`;
  }

  // Handle local Cambodia number starting with '0' (e.g., 012345678 -> +85512345678)
  if (digits.startsWith('0') && digits.length >= 8 && digits.length <= 11) {
    return `+855${digits.slice(1)}`;
  }

  return `+${digits}`;
}

/**
 * Masks a phone number for privacy in ordinary Admin list responses.
 * Examples:
 * - "+85512345678" -> "+855****5678"
 * - "+15550001234" -> "+1555****1234"
 * - null / undefined -> null
 */
export function maskPhone(phone?: string | null): string | null {
  if (!phone || typeof phone !== 'string') return null;

  const trimmed = phone.trim();
  if (trimmed.length < 7) return '***';

  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);

  return `${prefix}****${suffix}`;
}
