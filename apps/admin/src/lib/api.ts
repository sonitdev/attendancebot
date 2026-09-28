import type {
  AdminAttendanceQuery,
  AdminLoginInput,
  AdminSessionResponse,
  AssignmentListItem,
  AttendanceHistoryItem,
  CreateAssignmentInput,
  CreateEmployeeInput,
  CreateProjectInput,
  CreateSiteInput,
  CreateWorkScheduleInput,
  EmployeeListItem,
  EmployeePerformanceAnalytics,
  LinkTelegramInput,
  ProjectListItem,
  SiteListItem,
  WorkScheduleListItem,
  AuditLogListItem,
  AttendanceExceptionItem,
  AttendanceCorrectionItem,
  CreateCorrectionInput,
  ResolveCorrectionInput,
  AttendanceExportRow,
  AttendanceExportQuery,
  PositionListItem,
  CreatePositionInput,
  UpdatePositionInput,
  AssignPositionInput,
  EmployeePositionHistoryItem,
  PositionRequestListItem,
  ResolvePositionRequestInput,
  WorkerGroupListItem,
  WorkerGroupMemberItem,
  CreateWorkerGroupInput,
  UpdateWorkerGroupInput,
  BulkAssignmentPreviewInput,
  BulkAssignmentApplyInput,
  BulkAssignmentPreviewResponse,
  BulkAssignmentApplyResponse,
  RegistrationRequestListItem,
  ResolveRegistrationRequestInput,
} from '@workforce/contracts';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

export interface AdminUser {
  id: string;
  email: string;
  roles: string[];
}

export interface AdminOrg {
  id: string;
  name: string;
  slug: string;
}

export interface AdminAuthState {
  token: string;
  user: AdminUser;
  organization: AdminOrg;
}

const STORAGE_KEY = 'workforce_admin_session';

export function getStoredSession(): AdminAuthState | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AdminAuthState;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function setStoredSession(session: AdminAuthState) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }
}

export function clearStoredSession() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
  clearApiCache();
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const session = getStoredSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (session?.token) {
    headers['Authorization'] = `Bearer ${session.token}`;
  }
  if (session?.organization?.id) {
    headers['x-organization-id'] = session.organization.id;
  }

  try {
    const res = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errorMsg = data?.message || data?.error || `HTTP error ${res.status}`;
      throw new Error(typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg));
    }

    if ((options.method || 'GET').toUpperCase() !== 'GET') {
      clearApiCache();
    }
    return data as T;
  } catch (err: any) {
    if (err.message?.includes('fetch failed') || err.message?.includes('ECONNREFUSED')) {
      throw new Error('API server is starting up. Please refresh in a moment.');
    }
    throw err;
  }
}

const apiCache = new Map<string, { data: unknown; timestamp: number }>();
const inFlightRequests = new Map<string, Promise<unknown>>();
const DEFAULT_TTL_MS = 60_000; // 60s memory TTL for instant navigation
const MAX_STALE_MS = 5 * 60_000;

function cacheKey(endpoint: string): string {
  const session = getStoredSession();
  return `${session?.organization.id ?? 'anonymous'}:${session?.user.id ?? 'anonymous'}:${endpoint}`;
}

export function clearApiCache() {
  apiCache.clear();
}

export function getCachedApiData<T>(endpoint: string): T | null {
  const cached = apiCache.get(cacheKey(endpoint));
  return cached ? (cached.data as T) : null;
}

async function refreshCachedRequest<T>(key: string, endpoint: string, options: RequestInit): Promise<T> {
  let inFlight = inFlightRequests.get(key) as Promise<T> | undefined;
  if (!inFlight) {
    inFlight = request<T>(endpoint, options)
      .then((data) => {
        apiCache.set(key, { data, timestamp: Date.now() });
        return data;
      })
      .finally(() => inFlightRequests.delete(key));
    inFlightRequests.set(key, inFlight);
  }
  return inFlight;
}

async function cachedRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  forceRefresh = false,
  ttlMs = DEFAULT_TTL_MS,
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    const res = await request<T>(endpoint, options);
    clearApiCache();
    return res;
  }

  if (!forceRefresh) {
    const key = cacheKey(endpoint);
    const cached = apiCache.get(key);
    const age = cached ? Date.now() - cached.timestamp : Number.POSITIVE_INFINITY;
    if (cached && age < ttlMs) {
      return cached.data as T;
    }
    if (cached && age < MAX_STALE_MS) {
      // Stale-while-revalidate: tab navigation never waits on the network.
      void refreshCachedRequest<T>(key, endpoint, options);
      return cached.data as T;
    }
  }

  return refreshCachedRequest<T>(cacheKey(endpoint), endpoint, options);
}

export const adminApi = {
  // Auth
  async login(input: AdminLoginInput): Promise<AdminSessionResponse> {
    clearApiCache();
    const res = await request<AdminSessionResponse>('/auth/admin-login', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    setStoredSession({
      token: res.token,
      user: res.user,
      organization: res.organization,
    });
    return res;
  },

  // Today Attendance
  async getTodayAttendance(query: AdminAttendanceQuery = {}, forceRefresh = false) {
    const params = new URLSearchParams();
    if (query.siteId) params.append('siteId', query.siteId);
    if (query.projectId) params.append('projectId', query.projectId);
    if (query.date) params.append('date', query.date);
    const qs = params.toString();
    return cachedRequest<any[]>(`/attendance/today${qs ? `?${qs}` : ''}`, {}, forceRefresh);
  },

  async getAttendanceDetail(id: string, forceRefresh = false) {
    return cachedRequest<any>(`/attendance/${id}`, {}, forceRefresh);
  },

  // Employees
  async listEmployees(forceRefresh = false): Promise<EmployeeListItem[]> {
    return cachedRequest<EmployeeListItem[]>('/employees', {}, forceRefresh);
  },

  async createEmployee(input: CreateEmployeeInput) {
    return request<any>('/employees', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async updateEmployee(id: string, input: any) {
    return request<any>(`/employees/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  async deleteEmployee(id: string) {
    return request<any>(`/employees/${id}`, {
      method: 'DELETE',
    });
  },

  async linkTelegram(input: LinkTelegramInput) {
    return request<any>('/telegram/link', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  // Projects
  async listProjects(forceRefresh = false): Promise<ProjectListItem[]> {
    return cachedRequest<ProjectListItem[]>('/projects', {}, forceRefresh);
  },

  async createProject(input: CreateProjectInput) {
    return request<any>('/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async updateProject(id: string, input: any) {
    return request<any>(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  async deleteProject(id: string) {
    return request<any>(`/projects/${id}`, {
      method: 'DELETE',
    });
  },

  // Sites
  async listSites(forceRefresh = false): Promise<SiteListItem[]> {
    return cachedRequest<SiteListItem[]>('/sites', {}, forceRefresh);
  },

  async resolveMapLink(url: string): Promise<{ latitude: number; longitude: number; resolvedUrl: string }> {
    return request(`/map-links/resolve?url=${encodeURIComponent(url)}`);
  },

  async createSite(input: CreateSiteInput) {
    return request<any>('/sites', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async updateSite(id: string, input: any) {
    return request<any>(`/sites/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  async deleteSite(id: string) {
    return request<any>(`/sites/${id}`, {
      method: 'DELETE',
    });
  },

  // Schedules
  async listSchedules(forceRefresh = false): Promise<WorkScheduleListItem[]> {
    return cachedRequest<WorkScheduleListItem[]>('/schedules', {}, forceRefresh);
  },

  async createSchedule(input: CreateWorkScheduleInput) {
    return request<any>('/schedules', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async updateSchedule(id: string, input: any) {
    return request<any>(`/schedules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  async deleteSchedule(id: string) {
    return request<any>(`/schedules/${id}`, {
      method: 'DELETE',
    });
  },

  // Assignments
  async listAssignments(forceRefresh = false): Promise<AssignmentListItem[]> {
    return cachedRequest<AssignmentListItem[]>('/assignments', {}, forceRefresh);
  },

  async createAssignment(input: CreateAssignmentInput) {
    return request<any>('/assignments', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async updateAssignment(id: string, input: any) {
    return request<any>(`/assignments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  async deleteAssignment(id: string) {
    return request<any>(`/assignments/${id}`, {
      method: 'DELETE',
    });
  },

  // Analytics
  async getEmployeeAnalytics(employeeId: string, forceRefresh = false): Promise<EmployeePerformanceAnalytics> {
    return cachedRequest<EmployeePerformanceAnalytics>(`/employees/${employeeId}/analytics`, {}, forceRefresh);
  },

  async getEmployeeHistory(employeeId: string, forceRefresh = false): Promise<AttendanceHistoryItem[]> {
    return cachedRequest<AttendanceHistoryItem[]>(`/employees/${employeeId}/history`, {}, forceRefresh);
  },

  // Audit Logs
  async listAuditLogs(limit = 50, forceRefresh = false): Promise<AuditLogListItem[]> {
    return cachedRequest<AuditLogListItem[]>(`/audit-logs?limit=${limit}`, {}, forceRefresh);
  },

  // Exceptions & Corrections
  async getExceptions(query?: { siteId?: string; projectId?: string; status?: string }, forceRefresh = false): Promise<AttendanceExceptionItem[]> {
    const params = new URLSearchParams();
    if (query?.siteId) params.append('siteId', query.siteId);
    if (query?.projectId) params.append('projectId', query.projectId);
    if (query?.status) params.append('status', query.status);
    const qs = params.toString();
    return cachedRequest<AttendanceExceptionItem[]>(`/attendance/exceptions${qs ? `?${qs}` : ''}`, {}, forceRefresh);
  },

  async createCorrection(recordId: string, input: CreateCorrectionInput): Promise<AttendanceCorrectionItem> {
    return request<AttendanceCorrectionItem>(`/attendance/${recordId}/corrections`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async resolveCorrection(correctionId: string, input: ResolveCorrectionInput): Promise<AttendanceCorrectionItem> {
    return request<AttendanceCorrectionItem>(`/attendance/corrections/${correctionId}/resolve`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  // Attendance Export
  async exportAttendanceCsv(query?: { startDate?: string; endDate?: string; siteId?: string; projectId?: string }): Promise<string> {
    const session = getStoredSession();
    const params = new URLSearchParams({ format: 'csv' });
    if (query?.startDate) params.append('startDate', query.startDate);
    if (query?.endDate) params.append('endDate', query.endDate);
    if (query?.siteId) params.append('siteId', query.siteId);
    if (query?.projectId) params.append('projectId', query.projectId);

    const headers: Record<string, string> = {};
    if (session?.token) headers['Authorization'] = `Bearer ${session.token}`;
    if (session?.organization?.id) headers['x-organization-id'] = session.organization.id;

    const res = await fetch(`${API_BASE_URL}/attendance/export?${params.toString()}`, {
      headers,
    });
    if (!res.ok) {
      throw new Error(`Export failed with HTTP ${res.status}`);
    }
    return res.text();
  },

  async exportAttendanceJson(query?: { startDate?: string; endDate?: string; siteId?: string; projectId?: string }): Promise<AttendanceExportRow[]> {
    const params = new URLSearchParams({ format: 'json' });
    if (query?.startDate) params.append('startDate', query.startDate);
    if (query?.endDate) params.append('endDate', query.endDate);
    if (query?.siteId) params.append('siteId', query.siteId);
    if (query?.projectId) params.append('projectId', query.projectId);
    return request<AttendanceExportRow[]>(`/attendance/export?${params.toString()}`);
  },

  // Positions
  async listPositions(forceRefresh = false): Promise<PositionListItem[]> {
    return cachedRequest<PositionListItem[]>('/positions', {}, forceRefresh);
  },

  async createPosition(input: CreatePositionInput) {
    return request<PositionListItem>('/positions', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async updatePosition(id: string, input: UpdatePositionInput) {
    return request<PositionListItem>(`/positions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  async assignEmployeePosition(employeeId: string, input: AssignPositionInput) {
    return request<EmployeePositionHistoryItem>(`/employees/${employeeId}/position`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async getEmployeePositionHistory(employeeId: string, forceRefresh = false): Promise<EmployeePositionHistoryItem[]> {
    return cachedRequest<EmployeePositionHistoryItem[]>(`/employees/${employeeId}/position-history`, {}, forceRefresh);
  },

  // Position Requests
  async listPositionRequests(status?: string, forceRefresh = false): Promise<PositionRequestListItem[]> {
    return cachedRequest<PositionRequestListItem[]>(`/position-requests${status ? `?status=${status}` : ''}`, {}, forceRefresh);
  },

  async resolvePositionRequest(id: string, input: ResolvePositionRequestInput) {
    return request<PositionRequestListItem>(`/position-requests/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  // Worker Groups
  async listWorkerGroups(forceRefresh = false): Promise<WorkerGroupListItem[]> {
    return cachedRequest<WorkerGroupListItem[]>('/worker-groups', {}, forceRefresh);
  },

  async createWorkerGroup(input: CreateWorkerGroupInput) {
    return request<WorkerGroupListItem>('/worker-groups', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async updateWorkerGroup(id: string, input: UpdateWorkerGroupInput) {
    return request<WorkerGroupListItem>(`/worker-groups/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  async getWorkerGroupMembers(groupId: string, forceRefresh = false): Promise<WorkerGroupMemberItem[]> {
    return cachedRequest<WorkerGroupMemberItem[]>(`/worker-groups/${groupId}/members`, {}, forceRefresh);
  },

  async addWorkerGroupMembers(groupId: string, employeeIds: string[]) {
    return request<{ count: number }>(`/worker-groups/${groupId}/members`, {
      method: 'POST',
      body: JSON.stringify({ employeeIds }),
    });
  },

  async removeWorkerGroupMembers(groupId: string, employeeIds: string[]) {
    return request<{ count: number }>(`/worker-groups/${groupId}/members/remove`, {
      method: 'POST',
      body: JSON.stringify({ employeeIds }),
    });
  },

  // Bulk Assignments
  async previewBulkAssignments(input: BulkAssignmentPreviewInput): Promise<BulkAssignmentPreviewResponse> {
    return request<BulkAssignmentPreviewResponse>('/assignments/bulk/preview', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async applyBulkAssignments(input: BulkAssignmentApplyInput): Promise<BulkAssignmentApplyResponse> {
    return request<BulkAssignmentApplyResponse>('/assignments/bulk/apply', {
      method: 'POST',
      headers: {
        'idempotency-key': input.idempotencyKey,
      },
      body: JSON.stringify(input),
    });
  },

  // Registration Requests
  async listRegistrationRequests(status?: string, forceRefresh = false): Promise<RegistrationRequestListItem[]> {
    return cachedRequest<RegistrationRequestListItem[]>(`/registration-requests${status ? `?status=${status}` : ''}`, {}, forceRefresh);
  },

  async resolveRegistrationRequest(id: string, input: ResolveRegistrationRequestInput) {
    return request<{ id: string; status: string; createdEmployeeId?: string; employeeCode?: string }>(`/registration-requests/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
};
