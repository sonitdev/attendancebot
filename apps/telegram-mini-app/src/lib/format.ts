import { km } from '@workforce/contracts';

export function formatStatus(status?: string | null): string {
  if (!status) return '—';
  const translated = km.status[status as keyof typeof km.status];
  if (translated) return translated;
  return status
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
