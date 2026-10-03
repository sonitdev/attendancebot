import type {
  AttendanceActionResponse,
  AttendanceLocationInput,
  TelegramSessionResponse,
  WorkerTodayResponse,
  WorkerConnectedProject,
  RecordVisitInput,
  WorkerSalesDay,
  WorkerSalesOutlet,
  UpdateSalesVisitContextInput,
  UpdateDailySalesReportInput,
} from '@workforce/contracts';

const getApiBase = () => {
  if (typeof window !== 'undefined') {
    if (window.location.protocol === 'https:') {
      return '/api/v1';
    }
    return process.env.NEXT_PUBLIC_API_URL || '/api/v1';
  }
  return process.env.INTERNAL_API_URL || 'http://127.0.0.1:5131/api/v1';
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeRequestId(value: string | null | undefined): string | undefined {
  return value && requestIdPattern.test(value) ? value.toLowerCase() : undefined;
}

function readServerMs(header: string | null): number | undefined {
  const value = header?.match(/(?:^|,)\s*server\s*;\s*dur=([0-9]+(?:\.[0-9]+)?)(?=\s*(?:,|;|$))/)?.[1];
  const duration = value === undefined ? NaN : Number(value);
  return Number.isFinite(duration) ? duration : undefined;
}

/** Optional device-side spans; labels and correlation IDs are strictly bounded. */
export function recordClientTiming(name: string, ms: number, requestId?: string): void {
  if (process.env.NEXT_PUBLIC_DEBUG_REQUEST_TIMING !== 'true' || !Number.isFinite(ms) || ms < 0) return;
  const label = name === 'geolocation' || name === 'renderEvidencePhoto' ? name : 'other';
  try {
    console.debug('[client timing]', {
      name: label, durationMs: Math.round(ms * 100) / 100, requestId: safeRequestId(requestId),
    });
  } catch { /* Diagnostics must not affect GPS/photo capture. */ }
}

async function requestOnce<T>(
  endpoint: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const startedAt = performance.now();
  // One correlation ID per HTTP attempt, independent of attendance idempotency keys.
  let requestId = safeRequestId(globalThis.crypto?.randomUUID?.());
  let serverMs: number | undefined;
  let statusCode = 0;
  let outcome = 'error';
  const hasBody = options.body !== undefined && options.body !== null;
  const headers = new Headers(options.headers);
  if (hasBody && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  headers.set('ngrok-skip-browser-warning', '69420');
  headers.delete('x-request-id');
  if (requestId) headers.set('x-request-id', requestId);

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const apiBase = getApiBase();
  const url = `${apiBase}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timeoutId = setTimeout(() => {
    if (!controller.signal.aborted) {
      timedOut = true;
      controller.abort();
    }
  }, 20_000);
  try {
    controller.signal.throwIfAborted();
    const response = await fetch(url, { ...options, headers, signal: controller.signal });
    requestId = safeRequestId(response.headers.get('x-request-id')) ?? requestId;
    serverMs = readServerMs(response.headers.get('Server-Timing'));
    statusCode = response.status;
    if (response.status === 204) {
      outcome = 'success';
      return undefined as T;
    }
    // Keep the timeout active until the body has arrived, not just the headers.
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : null;
    if (!response.ok) {
      let message = data?.message || data?.error;
      if (response.status === 413) {
        message = 'រូបភាពមានទំហំធំពេក សូមថតម្ដងទៀត។';
      } else if (!message) {
        message = response.status === 502 || response.status === 503
          ? 'ម៉ាស៊ីនមេកំពុងរវល់ សូមព្យាយាមម្តងទៀត។'
          : `កំហុសម៉ាស៊ីនមេ (${response.status})`;
      }
      const code = data?.code || (response.status === 413 ? 'PHOTO_TOO_LARGE' : 'API_ERROR');
      throw new ApiError(Array.isArray(message) ? message.join(', ') : message, response.status, code, requestId);
    }
    if (data === null) throw new ApiError('Invalid server response', 502, 'INVALID_RESPONSE', requestId);
    outcome = 'success';
    return data as T;
  } catch (err: unknown) {
    if (err instanceof ApiError) throw err;
    if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      outcome = timedOut ? 'timeout' : 'cancelled';
      if (!timedOut) throw new ApiError('Request cancelled', 0, 'CANCELLED', requestId);
      throw new ApiError('ការតភ្ជាប់ទៅកាន់ម៉ាស៊ីនមេហួសពេលកំណត់ (Request Timeout)។ សូមព្យាយាមម្តងទៀត។', 408, 'TIMEOUT', requestId);
    }
    outcome = 'network_error';
    throw new ApiError('មិនអាចភ្ជាប់ទៅកាន់ម៉ាស៊ីនមេបានទេ។ សូមពិនិត្យមើលអ៊ីនធឺណិតរបស់អ្នក។', 0, 'NETWORK_ERROR', requestId);
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', onAbort);
    if (process.env.NEXT_PUBLIC_DEBUG_REQUEST_TIMING === 'true') {
      try {
        // Wall time includes body download/JSON parsing. Server time ends before transmission.
        // No URLs, headers, tokens, response bodies, coordinates or error messages.
        console.debug('[api timing]', {
          requestId, networkWallMs: Math.round((performance.now() - startedAt) * 100) / 100,
          serverMs, statusCode, outcome,
        });
      } catch { /* Diagnostics must never change an authoritative result. */ }
    }
  }
}

const pendingReads = new Map<string, Promise<unknown>>();

function request<T>(endpoint: string, options: RequestInit = {}, token?: string): Promise<T> {
  if (options.method !== 'GET') {
    return requestOnce<T>(endpoint, options, token).finally(() => {
      // A post-mutation refresh must not reuse a read started before the write.
      for (const key of pendingReads.keys()) {
        if (key.startsWith(`${token ?? ''}:`)) pendingReads.delete(key);
      }
    });
  }
  if (options.signal) return requestOnce<T>(endpoint, options, token);
  const key = `${token ?? ''}:${endpoint}`;
  const existing = pendingReads.get(key);
  if (existing) return existing as Promise<T>;
  const promise = requestOnce<T>(endpoint, options, token).finally(() => {
    if (pendingReads.get(key) === promise) pendingReads.delete(key);
  });
  pendingReads.set(key, promise);
  return promise;
}

export const api = {
  /**
   * Exchanges Telegram initData for a secure worker session token.
   */
  async createSession(initData: string, signal?: AbortSignal): Promise<TelegramSessionResponse> {
    return request<TelegramSessionResponse>('/telegram/session', {
      method: 'POST',
      body: JSON.stringify({ initData }),
      signal,
    });
  },

  /**
   * Retrieves today's active assignment, site, schedule, and attendance record.
   */
  async getToday(token: string, signal?: AbortSignal): Promise<WorkerTodayResponse> {
    return request<WorkerTodayResponse>('/worker/today', { method: 'GET', signal }, token);
  },

  async getConnectedProjects(token: string, signal?: AbortSignal): Promise<WorkerConnectedProject[]> {
    return request<WorkerConnectedProject[]>('/worker/projects', { method: 'GET', signal }, token);
  },

  async setCurrentProject(token: string, projectId: string): Promise<{ id: string; name: string }> {
    return request('/worker/current-project', { method: 'POST', body: JSON.stringify({ projectId }) }, token);
  },

  /**
   * Submits authoritative GPS check-in with idempotency.
   */
  async checkIn(
    token: string,
    location: AttendanceLocationInput & { proofPhotoDataUrl: string },
    idempotencyKey: string,
  ): Promise<AttendanceActionResponse> {
    return request<AttendanceActionResponse>(
      '/attendance/check-in',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(location),
      },
      token,
    );
  },

  /**
   * Submits authoritative GPS check-out with idempotency.
   */
  async checkOut(
    token: string,
    location: AttendanceLocationInput,
    idempotencyKey: string,
  ): Promise<AttendanceActionResponse> {
    return request<AttendanceActionResponse>(
      '/attendance/check-out',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(location),
      },
      token,
    );
  },

  async recordVisit(token: string, location: RecordVisitInput, idempotencyKey: string): Promise<{ visitId: string; verificationResult: string; timestamp: string; distanceMeters: number; message: string }> {
    return request('/worker/visits', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(location) }, token);
  },

  async getSalesOutlets(token: string): Promise<WorkerSalesOutlet[]> {
    return request<WorkerSalesOutlet[]>('/worker/sales-outlets', { method: 'GET' }, token);
  },

  async getSalesDay(token: string): Promise<WorkerSalesDay> {
    return request<WorkerSalesDay>('/worker/sales-day', { method: 'GET' }, token);
  },

  async updateSalesVisit(token: string, reportId: string, visitId: string, input: UpdateSalesVisitContextInput): Promise<unknown> {
    return request(`/worker/sales-reports/${reportId}/visits/${visitId}`, { method: 'PATCH', body: JSON.stringify(input) }, token);
  },

  async updateSalesReport(token: string, reportId: string, input: UpdateDailySalesReportInput): Promise<WorkerSalesDay> {
    return request<WorkerSalesDay>(`/worker/sales-reports/${reportId}`, { method: 'PATCH', body: JSON.stringify(input) }, token);
  },

  async submitSalesReport(token: string, reportId: string): Promise<WorkerSalesDay> {
    return request<WorkerSalesDay>(`/worker/sales-reports/${reportId}/submit`, { method: 'POST' }, token);
  },

  /**
   * Lists available active job positions in the organization.
   */
  async listPositions(token: string): Promise<Array<{ id: string; code: string; name: string }>> {
    return request<Array<{ id: string; code: string; name: string }>>('/positions', { method: 'GET' }, token);
  },

  /**
   * Checks if worker has an active pending position request.
   */
  async getPendingPositionRequest(token: string): Promise<any> {
    return request<any>('/worker/position-request/pending', { method: 'GET' }, token);
  },

  /**
   * Submits a request for an official job position.
   */
  async requestPosition(token: string, requestedPositionId: string): Promise<any> {
    return request<any>('/position-requests', {
      method: 'POST',
      body: JSON.stringify({ requestedPositionId }),
    }, token);
  },
};
