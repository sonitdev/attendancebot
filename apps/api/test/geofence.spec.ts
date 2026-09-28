import { describe, expect, it } from 'vitest';
import { haversineDistanceMeters, isLocationReliable } from '../src/attendance/geofence.js';

describe('geofence policy primitives', () => {
  it('returns zero for identical coordinates', () => {
    expect(haversineDistanceMeters({ latitude: 11.5564, longitude: 104.9282 }, { latitude: 11.5564, longitude: 104.9282 })).toBe(0);
  });

  it('does not treat an imprecise reading as reliable', () => {
    expect(isLocationReliable(800, 100)).toBe(false);
    expect(isLocationReliable(25, 100)).toBe(true);
  });
});
