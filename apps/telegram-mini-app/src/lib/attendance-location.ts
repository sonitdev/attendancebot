import { recordClientTiming } from './api';

/** One location fix per explicit attendance action; never a watcher or background tracker. */
export class AttendanceLocation {
  private position?: GeolocationPosition;
  private pending?: Promise<GeolocationPosition>;
  private generation = 0;

  prime(): void {
    void this.get().catch(() => undefined);
  }

  clear(): void {
    this.generation += 1;
    this.position = undefined;
    this.pending = undefined;
  }

  get(): Promise<GeolocationPosition> {
    if (this.position && Date.now() - this.position.timestamp >= 0 && Date.now() - this.position.timestamp <= 10_000) {
      return Promise.resolve(this.position);
    }
    if (this.pending) return this.pending;
    const generation = this.generation;
    const started = performance.now();
    const request = new Promise<GeolocationPosition>((resolve, reject) => {
      if (!navigator.geolocation) { reject({ code: 2 }); return; }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true, timeout: 20_000, maximumAge: 10_000,
      });
    }).then((position) => {
      if (generation === this.generation) this.position = position;
      return position;
    }).finally(() => {
      recordClientTiming('geolocation', performance.now() - started);
      if (this.pending === request) this.pending = undefined;
    });
    this.pending = request;
    return request;
  }
}
