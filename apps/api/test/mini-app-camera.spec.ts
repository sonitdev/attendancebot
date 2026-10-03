import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttendanceCamera } from '../../telegram-mini-app/src/lib/attendance-camera';

class FakeVideo extends EventTarget {
  srcObject: MediaStream | null = null;
  readyState = 2;
  videoWidth = 640;
  videoHeight = 480;
  muted = false;
  playsInline = false;
  play = vi.fn(async () => {});
}
function mediaStream() {
  const track = Object.assign(new EventTarget(), { readyState: 'live', stop: vi.fn() });
  return {
    track,
    stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => vi.advanceTimersByTimeAsync(0);
const mount = (camera: AttendanceCamera, video = new FakeVideo()) => {
  camera.attach(video as unknown as HTMLVideoElement);
  return video;
};
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('isSecureContext', true); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('live attendance camera lifecycle', () => {
  it('never requests media before an explicit start', () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const camera = new AttendanceCamera(vi.fn());
    mount(camera);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it.each(['stream-first', 'element-first'])('attaches preview for %s ordering', async order => {
    const { stream } = mediaStream();
    const state = vi.fn();
    const getUserMedia = vi.fn(async () => stream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const camera = new AttendanceCamera(state);
    const video = new FakeVideo();
    if (order === 'element-first') mount(camera, video);
    camera.start();
    await tick();
    if (order === 'stream-first') mount(camera, video);
    await tick();
    expect(video.srcObject).toBe(stream);
    expect(video.play).toHaveBeenCalledOnce();
    expect(video.muted && video.playsInline).toBe(true);
    expect(state).toHaveBeenLastCalledWith({ status: 'ready' });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: false, video: { facingMode: { ideal: 'environment' } } });
    camera.stop();
  });

  it('waits for an actual frame, not just video metadata', async () => {
    const { stream } = mediaStream();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
    const state = vi.fn();
    const camera = new AttendanceCamera(state);
    const video = mount(camera);
    video.readyState = 1;
    camera.start();
    await tick();
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(state).toHaveBeenLastCalledWith({ status: 'starting' });
    video.readyState = 2;
    video.dispatchEvent(new Event('loadeddata'));
    expect(state).toHaveBeenLastCalledWith({ status: 'ready' });
    camera.stop();
  });

  it('stops a stream whose permission resolves after close', async () => {
    const pending = deferred<MediaStream>();
    const { stream, track } = mediaStream();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => pending.promise } });
    const state = vi.fn();
    const camera = new AttendanceCamera(state);
    const video = mount(camera);
    camera.start();
    camera.stop();
    pending.resolve(stream);
    await tick();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    expect(state).toHaveBeenLastCalledWith({ status: 'idle' });
  });

  it('switches facing direction only after releasing the previous stream', async () => {
    const rear = mediaStream();
    const front = mediaStream();
    const getUserMedia = vi.fn().mockResolvedValueOnce(rear.stream).mockImplementationOnce(async () => {
      expect(rear.track.stop).toHaveBeenCalledOnce();
      return front.stream;
    });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const camera = new AttendanceCamera(vi.fn());
    const video = mount(camera);
    camera.start('environment');
    await tick();
    camera.start('user');
    await tick();
    expect(video.srcObject).toBe(front.stream);
    expect(getUserMedia.mock.calls[1][0]).toEqual({ audio: false, video: { facingMode: { ideal: 'user' } } });
    camera.stop();
    expect(front.track.stop).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
  });

  it('ignores and stops an old stream after a fast switch', async () => {
    const first = deferred<MediaStream>();
    const rear = mediaStream();
    const front = mediaStream();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(front.stream) } });
    const state = vi.fn();
    const camera = new AttendanceCamera(state);
    const video = mount(camera);
    camera.start('environment');
    camera.start('user');
    await tick();
    first.resolve(rear.stream);
    await tick();
    expect(rear.track.stop).toHaveBeenCalledOnce();
    expect(front.track.stop).not.toHaveBeenCalled();
    expect(video.srcObject).toBe(front.stream);
    expect(state).toHaveBeenLastCalledWith({ status: 'ready' });
    camera.stop();
  });

  it('bounds an ignored permission prompt and stops any late stream', async () => {
    const pending = deferred<MediaStream>();
    const late = mediaStream();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => pending.promise } });
    const state = vi.fn();
    const camera = new AttendanceCamera(state);
    camera.start();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(state).toHaveBeenLastCalledWith({ status: 'error', reason: 'TIMEOUT' });
    pending.resolve(late.stream);
    await tick();
    expect(late.track.stop).toHaveBeenCalledOnce();
    expect(state).toHaveBeenLastCalledWith({ status: 'error', reason: 'TIMEOUT' });
  });

  it('times out a granted camera that never produces a frame', async () => {
    const { stream, track } = mediaStream();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } });
    const state = vi.fn();
    const camera = new AttendanceCamera(state);
    const video = mount(camera);
    video.videoWidth = 0;
    camera.start();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(state).toHaveBeenLastCalledWith({ status: 'error', reason: 'TIMEOUT' });
  });

  it.each([
    ['NotAllowedError', 'PERMISSION_DENIED'], ['SecurityError', 'PERMISSION_DENIED'],
    ['NotReadableError', 'BUSY'], ['AbortError', 'BUSY'], ['NotFoundError', 'UNAVAILABLE'],
  ])('maps %s to a safe actionable state', async (name, reason) => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue({ name, message: 'private device details' }) } });
    const state = vi.fn();
    new AttendanceCamera(state).start();
    await tick();
    expect(state).toHaveBeenLastCalledWith({ status: 'error', reason });
    expect(JSON.stringify(state.mock.calls)).not.toContain('private');
  });

  it('reports insecure and unsupported contexts without requesting permission', () => {
    const state = vi.fn();
    const getUserMedia = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal('isSecureContext', false);
    const camera = new AttendanceCamera(state);
    camera.start();
    expect(state).toHaveBeenLastCalledWith({ status: 'error', reason: 'INSECURE' });
    expect(getUserMedia).not.toHaveBeenCalled();
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', {});
    camera.start();
    expect(state).toHaveBeenLastCalledWith({ status: 'error', reason: 'UNSUPPORTED' });
  });

  it('releases media on playback rejection and supports explicit retry', async () => {
    const first = mediaStream();
    const next = mediaStream();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(next.stream) } });
    const state = vi.fn();
    const camera = new AttendanceCamera(state);
    const video = mount(camera);
    video.play.mockRejectedValueOnce(new Error('blocked'));
    camera.start();
    await tick();
    expect(first.track.stop).toHaveBeenCalledOnce();
    expect(state).toHaveBeenLastCalledWith({ status: 'error', reason: 'PLAYBACK' });
    camera.start();
    await tick();
    expect(video.srcObject).toBe(next.stream);
    expect(state).toHaveBeenLastCalledWith({ status: 'ready' });
    camera.stop();
  });

  it('reports a camera disconnected after startup and releases its preview', async () => {
    const { stream, track } = mediaStream();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } });
    const state = vi.fn();
    const camera = new AttendanceCamera(state);
    const video = mount(camera);
    camera.start();
    await tick();
    track.dispatchEvent(new Event('ended'));
    expect(video.srcObject).toBeNull();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(state).toHaveBeenLastCalledWith({ status: 'error', reason: 'UNAVAILABLE' });
  });

  it('does not expose a gallery picker in the attendance camera UI', () => {
    const actions = readFileSync(new URL('../../telegram-mini-app/src/app/camera-proof-actions.tsx', import.meta.url), 'utf8');
    const page = readFileSync(new URL('../../telegram-mini-app/src/app/page.tsx', import.meta.url), 'utf8');
    expect(actions + page).not.toMatch(/type=["']file["']|useFallbackPhoto|createObjectURL|FileReader/);
    expect(actions).toContain("onSwitch('user')");
    expect(actions).toContain("onSwitch('environment')");
    expect(page).toContain('renderEvidencePhoto(video,');
    expect(page).not.toContain("dynamic(() => import('./camera-proof-preview')");
  });
});
