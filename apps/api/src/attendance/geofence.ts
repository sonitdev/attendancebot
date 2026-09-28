const EARTH_RADIUS_METERS = 6_371_000;

export function haversineDistanceMeters(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLatitude = toRadians(to.latitude - from.latitude);
  const deltaLongitude = toRadians(to.longitude - from.longitude);
  const a = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isLocationReliable(accuracyMeters: number, maxAccuracyMeters: number): boolean {
  return Number.isFinite(accuracyMeters) && accuracyMeters > 0 && accuracyMeters <= maxAccuracyMeters;
}
