import type {
  AttendanceActionResponse,
  AttendanceLocationInput,
  TelegramSessionResponse,
  WorkerTodayResponse,
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
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const apiBase = getApiBase();
  const url = `${apiBase}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  let response: Response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (err) {
    throw new ApiError('Unable to connect to the attendance server. Please check your internet connection.', 0, 'NETWORK_ERROR');
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.message || data?.error || 'An unexpected error occurred.';
    const code = data?.code || 'API_ERROR';
    throw new ApiError(Array.isArray(message) ? message.join(', ') : message, response.status, code);
  }

  return data as T;
}

export const api = {
  /**
   * Exchanges Telegram initData for a secure worker session token.
   */
  async createSession(initData: string): Promise<TelegramSessionResponse> {
    return request<TelegramSessionResponse>('/telegram/session', {
      method: 'POST',
      body: JSON.stringify({ initData }),
    });
  },

  /**
   * Retrieves today's active assignment, site, schedule, and attendance record.
   */
  async getToday(token: string): Promise<WorkerTodayResponse> {
    return request<WorkerTodayResponse>('/worker/today', { method: 'GET' }, token);
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
