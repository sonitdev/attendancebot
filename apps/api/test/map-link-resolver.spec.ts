import { describe, expect, it } from 'vitest';
import { extractCoordinates } from '../src/admin/map-link-resolver.service.js';

describe('Google Maps coordinate extraction', () => {
  it('extracts decimal coordinates from a Google Maps pin URL', () => {
    expect(extractCoordinates('https://www.google.com/maps/@11.572108,104.895548,18z')).toEqual({
      latitude: 11.572108,
      longitude: 104.895548,
    });
  });

  it('prefers the exact place pin over the map viewport', () => {
    expect(
      extractCoordinates('https://www.google.com/maps/place/X/@11.5721381,104.8931373,17z/data=!3m1!4b1!8m2!3d11.5721329!4d104.8957122'),
    ).toEqual({ latitude: 11.5721329, longitude: 104.8957122 });
  });

  it('converts Google Maps DMS coordinates to decimal degrees', () => {
    const result = extractCoordinates('11°34\'19.6"N 104°53\'44.0"E');
    expect(result?.latitude).toBeCloseTo(11.572111, 6);
    expect(result?.longitude).toBeCloseTo(104.895556, 6);
  });

  it('rejects invalid coordinates', () => {
    expect(extractCoordinates('https://www.google.com/maps/@91,181,18z')).toBeNull();
  });
});
