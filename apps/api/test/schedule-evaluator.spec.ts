import { describe, expect, it } from 'vitest';
import {
  calculateWorkDurationMinutes,
  evaluateCheckInStatus,
  evaluateCheckOutStatus,
  getSiteDate,
  getSiteTimeMinutes,
  parseTimeToMinutes,
} from '../src/attendance/schedule-evaluator.js';

describe('schedule-evaluator', () => {
  it('correctly parses HH:mm to minutes from midnight', () => {
    expect(parseTimeToMinutes('00:00')).toBe(0);
    expect(parseTimeToMinutes('08:00')).toBe(480);
    expect(parseTimeToMinutes('08:15')).toBe(495);
    expect(parseTimeToMinutes('17:30')).toBe(1050);
  });

  it('correctly computes site calendar date across timezones', () => {
    // 2026-09-18 20:00:00 UTC is 2026-09-19 03:00:00 in Asia/Phnom_Penh (UTC+7)
    const lateUtc = new Date('2026-09-18T20:00:00.000Z');
    expect(getSiteDate(lateUtc, 'UTC')).toBe('2026-09-18');
    expect(getSiteDate(lateUtc, 'Asia/Phnom_Penh')).toBe('2026-09-19');

    // 2026-09-18 02:00:00 UTC is 2026-09-17 22:00:00 in America/New_York (UTC-4)
    const earlyUtc = new Date('2026-09-18T02:00:00.000Z');
    expect(getSiteDate(earlyUtc, 'America/New_York')).toBe('2026-09-17');
  });

  it('evaluates check-in as ON_TIME when arrival is within grace period', () => {
    // 01:00 UTC is 08:00 in Asia/Phnom_Penh (UTC+7)
    const onTimeArrival = new Date('2026-09-18T01:00:00.000Z');
    const status = evaluateCheckInStatus({
      checkInAt: onTimeArrival,
      siteTimezone: 'Asia/Phnom_Penh',
      startTime: '08:00',
      graceMinutes: 15,
      verification: 'VERIFIED',
    });
    expect(status).toBe('ON_TIME');

    // 01:10 UTC is 08:10 in Asia/Phnom_Penh (within 15m grace)
    const withinGraceArrival = new Date('2026-09-18T01:10:00.000Z');
    const statusGrace = evaluateCheckInStatus({
      checkInAt: withinGraceArrival,
      siteTimezone: 'Asia/Phnom_Penh',
      startTime: '08:00',
      graceMinutes: 15,
      verification: 'VERIFIED',
    });
    expect(statusGrace).toBe('ON_TIME');
  });

  it('evaluates check-in as LATE when arrival exceeds grace period', () => {
    // 01:20 UTC is 08:20 in Asia/Phnom_Penh (exceeds 15m grace for 08:00 start)
    const lateArrival = new Date('2026-09-18T01:20:00.000Z');
    const status = evaluateCheckInStatus({
      checkInAt: lateArrival,
      siteTimezone: 'Asia/Phnom_Penh',
      startTime: '08:00',
      graceMinutes: 15,
      verification: 'VERIFIED',
    });
    expect(status).toBe('LATE');
  });

  it('reflects verification failures in check-in status', () => {
    const arrival = new Date('2026-09-18T01:00:00.000Z');
    expect(
      evaluateCheckInStatus({
        checkInAt: arrival,
        siteTimezone: 'Asia/Phnom_Penh',
        startTime: '08:00',
        graceMinutes: 15,
        verification: 'OUTSIDE_GEOFENCE',
      }),
    ).toBe('OUTSIDE_GEOFENCE');

    expect(
      evaluateCheckInStatus({
        checkInAt: arrival,
        siteTimezone: 'Asia/Phnom_Penh',
        startTime: '08:00',
        graceMinutes: 15,
        verification: 'LOW_ACCURACY',
      }),
    ).toBe('LOW_ACCURACY');
  });

  it('evaluates check-out as EARLY_CHECKOUT when departure is before shift end', () => {
    // 09:30 UTC is 16:30 in Asia/Phnom_Penh (shift ends at 17:00)
    const earlyDeparture = new Date('2026-09-18T09:30:00.000Z');
    const status = evaluateCheckOutStatus({
      checkOutAt: earlyDeparture,
      siteTimezone: 'Asia/Phnom_Penh',
      endTime: '17:00',
      verification: 'VERIFIED',
    });
    expect(status).toBe('EARLY_CHECKOUT');
  });

  it('evaluates check-out as COMPLETED when departure is at or after shift end', () => {
    // 10:05 UTC is 17:05 in Asia/Phnom_Penh (shift ends at 17:00)
    const onTimeDeparture = new Date('2026-09-18T10:05:00.000Z');
    const status = evaluateCheckOutStatus({
      checkOutAt: onTimeDeparture,
      siteTimezone: 'Asia/Phnom_Penh',
      endTime: '17:00',
      verification: 'VERIFIED',
    });
    expect(status).toBe('COMPLETED');
  });

  it('calculates work duration in minutes correctly', () => {
    const checkIn = new Date('2026-09-18T01:00:00.000Z');
    const checkOut = new Date('2026-09-18T09:30:00.000Z'); // 8.5 hours = 510 minutes
    expect(calculateWorkDurationMinutes(checkIn, checkOut)).toBe(510);
  });
});
