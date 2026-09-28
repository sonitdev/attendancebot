export interface WorkerPrincipal {
  type: 'worker';
  organizationId: string;
  employeeId: string;
  telegramUserId: string;
  sessionId: string;
}

export interface AdminPrincipal {
  type: 'admin';
  organizationId: string;
  userId: string;
  email: string;
  roles: string[];
  permissions: string[];
}

export type Principal = WorkerPrincipal | AdminPrincipal;

export function isWorkerPrincipal(principal: Principal): principal is WorkerPrincipal {
  return principal.type === 'worker';
}

export function isAdminPrincipal(principal: Principal): principal is AdminPrincipal {
  return principal.type === 'admin';
}
