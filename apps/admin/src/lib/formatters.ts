/**
 * Helper utility to format raw uppercase enum values (e.g. OUTSIDE_GEOFENCE, ATTENDANCE_CHECK_IN)
 * into clean, readable Title Case strings without ALL CAPS.
 */
export function formatStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  const translated = km.status[status as keyof typeof km.status];
  if (translated) return translated;
  return status
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
import { km } from '@workforce/contracts';
