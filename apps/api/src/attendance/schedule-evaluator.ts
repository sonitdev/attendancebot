import type { AttendanceStatus, AttendanceVerificationStatus } from '@workforce/contracts';

export function getSiteDate(utcDate: Date, timeZone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(utcDate); // produces YYYY-MM-DD
  } catch {
    // Fallback to UTC if timezone is invalid
    return utcDate.toISOString().slice(0, 10);
  }
}

export function parseTimeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function getSiteTimeMinutes(utcDate: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(utcDate);

    const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
    const minuteStr = parts.find((p) => p.type === 'minute')?.value ?? '0';
    const hour = hourStr === '24' ? 0 : Number(hourStr);
    const minute = Number(minuteStr);

    return hour * 60 + minute;
  } catch {
    return utcDate.getUTCHours() * 60 + utcDate.getUTCMinutes();
  }
}

export function evaluateCheckInStatus(params: {
  checkInAt: Date;
  siteTimezone: string;
  startTime: string;
  graceMinutes: number;
  verification: AttendanceVerificationStatus;
}): AttendanceStatus {
  if (params.verification === 'OUTSIDE_GEOFENCE') {
    return 'OUTSIDE_GEOFENCE';
  }
  if (params.verification === 'LOW_ACCURACY') {
    return 'LOW_ACCURACY';
  }
  if (params.verification !== 'VERIFIED') {
    return 'PENDING_REVIEW';
  }

  const arrivalMinutes = getSiteTimeMinutes(params.checkInAt, params.siteTimezone);
  const scheduledStartMinutes = parseTimeToMinutes(params.startTime);
  const cutoffMinutes = scheduledStartMinutes + params.graceMinutes;

  return arrivalMinutes <= cutoffMinutes ? 'ON_TIME' : 'LATE';
}

export function evaluateCheckOutStatus(params: {
  checkOutAt: Date;
  siteTimezone: string;
  endTime: string;
  verification: AttendanceVerificationStatus;
}): AttendanceStatus {
  if (params.verification === 'OUTSIDE_GEOFENCE') {
    return 'OUTSIDE_GEOFENCE';
  }
  if (params.verification === 'LOW_ACCURACY') {
    return 'LOW_ACCURACY';
  }
  if (params.verification !== 'VERIFIED') {
    return 'PENDING_REVIEW';
  }

  const departureMinutes = getSiteTimeMinutes(params.checkOutAt, params.siteTimezone);
  const scheduledEndMinutes = parseTimeToMinutes(params.endTime);

  return departureMinutes < scheduledEndMinutes ? 'EARLY_CHECKOUT' : 'COMPLETED';
}

export function calculateWorkDurationMinutes(checkInAt: Date, checkOutAt: Date): number {
  const diffMs = checkOutAt.getTime() - checkInAt.getTime();
  return Math.max(0, Math.round(diffMs / 60_000));
}

export function formatSiteDateTime(utcDate: Date | null, timeZone: string): string {
  if (!utcDate) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .format(utcDate)
      .replace(',', '');
  } catch {
    return utcDate.toISOString();
  }
}

