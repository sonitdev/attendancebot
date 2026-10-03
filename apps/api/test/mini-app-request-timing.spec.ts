import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, recordClientTiming } from '../../telegram-mini-app/src/lib/api';

const serverId = 'e5be0261-09af-438f-97c8-8d0fb1102afa';
const privateValue = 'private-token-location-photo-initData';
beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_DEBUG_REQUEST_TIMING', 'true'); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('Mini App private request correlation and timing', () => {
  it('creates per-attempt UUIDs without changing attendance idempotency or payloads', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ saved: true }));
    vi.stubGlobal('fetch', fetchMock);
    const body = { latitude: 11.55, longitude: 104.9, accuracyMeters: 3, proofPhotoDataUrl: privateValue };
    await api.checkIn(privateValue, body, 'same-idempotency-key');
    await api.checkIn(privateValue, body, 'same-idempotency-key');
    const headers = fetchMock.mock.calls.map(call => new Headers(call[1].headers));
    expect(headers[0].get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers[0].get('x-request-id')).not.toBe(headers[1].get('x-request-id'));
    expect(headers.every(header => header.get('Idempotency-Key') === 'same-idempotency-key')).toBe(true);
    expect(headers[0].get('Authorization')).toBe(`Bearer ${privateValue}`);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(body);
    expect(JSON.stringify(debug.mock.calls)).not.toMatch(/private|latitude|longitude|11\.55|104\.9|same-idempotency-key/);
  });

  it('uses the validated server UUID and measures wall time through body parsing', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json', 'x-request-id': serverId, 'Server-Timing': 'server;dur=12.34, handler;dur=5' }),
      json: async () => { await delay(10); return { token: privateValue }; },
    })));
    await expect(api.createSession(privateValue)).resolves.toEqual({ token: privateValue });
    expect(debug).toHaveBeenCalledTimes(1);
    const entry = debug.mock.calls[0][1];
    expect(entry).toMatchObject({ requestId: serverId, serverMs: 12.34, statusCode: 200, outcome: 'success' });
    expect(entry.networkWallMs).toBeGreaterThanOrEqual(8);
    expect(JSON.stringify(debug.mock.calls)).not.toContain(privateValue);
  });

  it('correlates API errors without logging the response message', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ message: privateValue, code: 'DENIED' }, { status: 403, headers: { 'x-request-id': serverId } })));
    await expect(api.getToday(privateValue)).rejects.toMatchObject({ statusCode: 403, code: 'DENIED', requestId: serverId });
    expect(debug.mock.calls[0][1]).toMatchObject({ requestId: serverId, statusCode: 403, outcome: 'error' });
    expect(JSON.stringify(debug.mock.calls)).not.toContain(privateValue);
  });

  it('discards malformed diagnostic headers and works when client UUID generation is unavailable', async () => {
    vi.stubGlobal('crypto', undefined);
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const fetchMock = vi.fn(async () => Response.json({ ok: true }, { headers: { 'x-request-id': privateValue, 'Server-Timing': `server;dur=Infinity,${privateValue}` } }));
    vi.stubGlobal('fetch', fetchMock);
    await api.createSession(privateValue);
    expect(new Headers(fetchMock.mock.calls[0][1].headers).has('x-request-id')).toBe(false);
    expect(debug.mock.calls[0][1]).toMatchObject({ requestId: undefined, serverMs: undefined });
    expect(JSON.stringify(debug.mock.calls)).not.toContain(privateValue);
  });

  it('keeps logs opt-in and prevents logging failures from changing successful writes', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => { throw new Error('logger unavailable'); });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true })));
    vi.stubEnv('NEXT_PUBLIC_DEBUG_REQUEST_TIMING', 'false');
    await api.createSession(privateValue);
    recordClientTiming('geolocation', 1);
    expect(debug).not.toHaveBeenCalled();
    vi.stubEnv('NEXT_PUBLIC_DEBUG_REQUEST_TIMING', 'true');
    await expect(api.createSession(privateValue)).resolves.toEqual({ ok: true });
    expect(() => recordClientTiming('geolocation', 2)).not.toThrow();
  });

  it('records only approved device labels, finite durations, and valid correlation IDs', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    recordClientTiming('geolocation', 123.456, serverId);
    recordClientTiming('renderEvidencePhoto', 5);
    recordClientTiming(privateValue, 2, privateValue);
    for (const value of [NaN, Infinity, -1]) recordClientTiming('geolocation', value);
    expect(debug).toHaveBeenCalledTimes(3);
    expect(debug.mock.calls[0][1]).toEqual({ name: 'geolocation', durationMs: 123.46, requestId: serverId });
    expect(debug.mock.calls[2][1]).toEqual({ name: 'other', durationMs: 2, requestId: undefined });
    expect(JSON.stringify(debug.mock.calls)).not.toContain(privateValue);
  });

  it('distinguishes user cancellation from timeout, including pre-abort and body cancellation', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const fetchMock = vi.fn(async (_url, options) => ({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json', 'x-request-id': serverId }),
      json: () => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException(privateValue, 'AbortError')))),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const preAborted = new AbortController();
    preAborted.abort();
    await expect(api.getToday(privateValue, preAborted.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fetchMock).not.toHaveBeenCalled();
    const controller = new AbortController();
    const result = api.getToday(privateValue, controller.signal);
    const assertion = expect(result).rejects.toMatchObject({ code: 'CANCELLED', requestId: serverId });
    await Promise.resolve();
    controller.abort();
    await assertion;
    expect(debug.mock.calls[1][1]).toMatchObject({ outcome: 'cancelled', requestId: serverId });
    expect(JSON.stringify(debug.mock.calls)).not.toContain(privateValue);
  });

  it('retains timing/correlation when the body hits the existing 20-second timeout', async () => {
    vi.useFakeTimers();
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => ({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json', 'x-request-id': serverId, 'Server-Timing': 'server;dur=8' }),
      json: () => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    })));
    const assertion = expect(api.getToday(privateValue)).rejects.toMatchObject({ code: 'TIMEOUT', requestId: serverId });
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(debug.mock.calls[0][1]).toMatchObject({ outcome: 'timeout', requestId: serverId, serverMs: 8 });
  });
});
