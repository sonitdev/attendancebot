import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttendanceLocation } from '../../telegram-mini-app/src/lib/attendance-location';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('attendance one-shot GPS', () => {
  it('does not collect on construction; shares the camera-start fix with submit', async () => {
    let succeed!: PositionCallback;
    const getCurrentPosition = vi.fn((success) => { succeed = success; });
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    const location = new AttendanceLocation();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    location.prime();
    const submission = location.get();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    const position = { timestamp: Date.now(), coords: { accuracy: 12 } } as GeolocationPosition;
    succeed(position);
    await expect(submission).resolves.toBe(position);
    await expect(location.get()).resolves.toBe(position);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('refreshes expired evidence and does not retain a cancelled capture', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T01:00:00Z'));
    const getCurrentPosition = vi.fn(success => success({ timestamp: Date.now(), coords: { accuracy: 10 } }));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    const location = new AttendanceLocation();
    await location.get();
    vi.advanceTimersByTime(10_001);
    await location.get();
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    location.clear();
    await location.get();
    expect(getCurrentPosition).toHaveBeenCalledTimes(3);
    expect(getCurrentPosition.mock.calls[0][2]).toEqual({ enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
  });

  it('allows an explicit retry after permission or availability failure', async () => {
    const getCurrentPosition = vi.fn((_success, reject) => reject({ code: 1 }));
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    const location = new AttendanceLocation();
    await expect(location.get()).rejects.toEqual({ code: 1 });
    await expect(location.get()).rejects.toEqual({ code: 1 });
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
  });
});
