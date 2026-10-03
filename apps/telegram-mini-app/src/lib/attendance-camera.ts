export type CameraFacing = 'user' | 'environment';
export type CameraFailure = 'PERMISSION_DENIED' | 'UNSUPPORTED' | 'INSECURE' | 'UNAVAILABLE' | 'BUSY' | 'TIMEOUT' | 'PLAYBACK';
export type CameraState = { status: 'idle' | 'starting' | 'ready' } | { status: 'error'; reason: CameraFailure };

function cameraFailure(error: unknown): CameraFailure {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'PERMISSION_DENIED';
  if (name === 'NotReadableError' || name === 'AbortError') return 'BUSY';
  return 'UNAVAILABLE';
}

/** User-initiated live preview only: no files, background capture or saved device identifiers. */
export class AttendanceCamera {
  private video: HTMLVideoElement | null = null;
  private stream?: MediaStream;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private detachListeners?: () => void;
  private detachTrackListeners?: () => void;

  constructor(private readonly onState: (state: CameraState) => void) {}

  /** Works whether permission resolves before or after the preview mounts. */
  attach(video: HTMLVideoElement | null): void {
    if (this.video === video) return;
    this.detachVideo();
    this.video = video;
    if (video && this.stream) this.connectPreview(this.generation);
  }

  start(facing: CameraFacing = 'environment'): void {
    this.release();
    const generation = this.generation;
    this.onState({ status: 'starting' });
    if (globalThis.isSecureContext === false) return this.fail(generation, 'INSECURE');
    if (!navigator.mediaDevices?.getUserMedia) return this.fail(generation, 'UNSUPPORTED');
    // Permission prompts can remain unresolved. Stop any stream arriving after the deadline.
    this.timer = setTimeout(() => this.fail(generation, 'TIMEOUT'), 12_000);
    try {
      void navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } }, audio: false })
        .then(stream => {
          if (generation !== this.generation) {
            stream.getTracks().forEach(track => track.stop());
            return;
          }
          this.stream = stream;
          const tracks = stream.getVideoTracks();
          if (!tracks.length || tracks.every(track => track.readyState === 'ended')) {
            this.fail(generation, 'UNAVAILABLE');
            return;
          }
          const ended = () => this.fail(generation, 'UNAVAILABLE');
          tracks.forEach(track => track.addEventListener('ended', ended));
          this.detachTrackListeners = () => tracks.forEach(track => track.removeEventListener('ended', ended));
          if (this.video) this.connectPreview(generation);
        }).catch(error => this.fail(generation, cameraFailure(error)));
    } catch (error) {
      this.fail(generation, cameraFailure(error));
    }
  }

  stop(): void {
    this.release();
    this.onState({ status: 'idle' });
  }

  private connectPreview(generation: number): void {
    const video = this.video;
    const stream = this.stream;
    if (!video || !stream) return;
    const isCurrent = () => generation === this.generation && this.video === video && this.stream === stream;
    const ready = () => {
      if (!isCurrent() || video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) return;
      clearTimeout(this.timer);
      this.timer = undefined;
      this.onState({ status: 'ready' });
    };
    const failed = () => { if (isCurrent()) this.fail(generation, 'PLAYBACK'); };
    video.addEventListener('loadeddata', ready);
    video.addEventListener('playing', ready);
    video.addEventListener('error', failed);
    this.detachListeners = () => {
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('playing', ready);
      video.removeEventListener('error', failed);
    };
    try {
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      void video.play().then(ready).catch(failed);
    } catch { failed(); }
  }

  private fail(generation: number, reason: CameraFailure): void {
    if (generation !== this.generation) return;
    this.release();
    this.onState({ status: 'error', reason });
  }

  private detachVideo(): void {
    this.detachListeners?.();
    this.detachListeners = undefined;
    if (this.video) this.video.srcObject = null;
  }

  private release(): void {
    this.generation += 1;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.detachTrackListeners?.();
    this.detachTrackListeners = undefined;
    this.detachVideo();
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined;
  }
}
