import type { AttendanceActionResponse, WorkerTodayResponse } from '@workforce/contracts';

/** Only server-returned timestamps/statuses are applied; no optimistic attendance facts. */
export function applyAttendanceResult(today: WorkerTodayResponse, result: AttendanceActionResponse): WorkerTodayResponse {
  if (result.action === 'CHECK_OUT' && today.attendance?.id !== result.attendanceId) return today;
  return {
    ...today,
    attendance: {
      id: result.attendanceId,
      status: result.status,
      checkInAt: result.action === 'CHECK_IN' ? result.timestamp : today.attendance!.checkInAt,
      checkOutAt: result.action === 'CHECK_OUT' ? result.timestamp : null,
      verification: result.action === 'CHECK_IN' ? result.verificationResult : today.attendance!.verification,
      workDurationMinutes: result.workDurationMinutes,
    },
  };
}

export function isUncertainSubmission(error: unknown): boolean {
  const status = (error as { statusCode?: number })?.statusCode;
  // A lost/invalid response or server failure is not proof the transaction rolled back.
  return status === 0 || status === 408 || (status !== undefined && status >= 500);
}

export function hasSavedAttendance(before: WorkerTodayResponse, after: WorkerTodayResponse, action: 'CHECK_IN' | 'CHECK_OUT' | 'VISIT') {
  if (before.assignment.id !== after.assignment.id || before.date !== after.date || before.currentProject.id !== after.currentProject.id) return false;
  if (action === 'CHECK_IN') return Boolean(after.attendance?.checkInAt && after.attendance.checkInAt !== before.attendance?.checkInAt);
  if (action === 'CHECK_OUT') return Boolean(after.attendance?.checkOutAt && after.attendance.id === before.attendance?.id && after.attendance.checkOutAt !== before.attendance?.checkOutAt);
  return false;
}

/** Retain the original key AND payload closure after an uncertain network outcome. */
export class AttendanceSubmission {
  private pending = new Map<string, () => Promise<unknown>>();
  private running = new Map<string, Promise<unknown>>();

  confirm(scope: string) { this.pending.delete(scope); }

  submit<T>(scope: string, send: (key: string) => Promise<T>): Promise<T> {
    const active = this.running.get(scope);
    if (active) return active as Promise<T>;
    let attempt = this.pending.get(scope);
    if (!attempt) {
      const key = crypto.randomUUID();
      attempt = () => send(key);
      this.pending.set(scope, attempt);
    }
    const promise = Promise.resolve().then(attempt).then((result) => {
      this.pending.delete(scope);
      return result;
    }).catch((error: unknown) => {
      if (!isUncertainSubmission(error)) this.pending.delete(scope);
      throw error;
    }).finally(() => this.running.delete(scope));
    this.running.set(scope, promise);
    return promise as Promise<T>;
  }
}

export function notifyAttendanceHaptic(verification: string) {
  try {
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred(verification === 'VERIFIED' ? 'success' : 'warning');
  } catch {
    // An optional device effect must never turn a saved record into a failed action.
  }
}
