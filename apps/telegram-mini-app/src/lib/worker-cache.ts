import type { TelegramSessionResponse, WorkerTodayResponse } from '@workforce/contracts';

const SESSION_KEY = 'workforce_worker_session';
const TODAY_KEY = 'workforce_worker_today';

export function hasCurrentAssignment(today: WorkerTodayResponse | null): today is WorkerTodayResponse {
  return Boolean(today?.currentProject?.name && today?.site?.name);
}

export function readWorkerCache(session: TelegramSessionResponse): { today: WorkerTodayResponse | null } {
  if (typeof window === 'undefined') return { today: null };
  try {
    const rawToday = localStorage.getItem(TODAY_KEY);
    const cached = rawToday ? JSON.parse(rawToday) : null;
    const today = cached?.today as WorkerTodayResponse | null;
    const age = Date.now() - cached?.savedAt;
    const date = today?.site?.timezone
      ? new Intl.DateTimeFormat('en-CA', { timeZone: today.site.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
      : null;
    if (cached?.employeeId === session.employee.id && cached?.organizationId === session.organization.id
      && Date.parse(session.expiresAt) > Date.now() && age >= 0 && age < 60_000
      && hasCurrentAssignment(today) && today.date === date) return { today };
    localStorage.removeItem(TODAY_KEY);
    return { today: null };
  } catch {
    return { today: null };
  }
}

export function clearLegacyWorkerSession(): void {
  // Do not persist bearer tokens. Session authentication happens on every launch.
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

export function writeWorkerToday(today: WorkerTodayResponse | null, session: TelegramSessionResponse | null): void {
  try {
    if (hasCurrentAssignment(today) && session) localStorage.setItem(TODAY_KEY, JSON.stringify({
      today, employeeId: session.employee.id, organizationId: session.organization.id, savedAt: Date.now(),
    }));
    else localStorage.removeItem(TODAY_KEY);
  } catch {}
}
