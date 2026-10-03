import type { AttendanceActionResponse, WorkerConnectedProject, WorkerTodayResponse } from '@workforce/contracts';
import type { WorkerPrincipal } from '../auth/principal.js';
import type { PrismaService } from '../prisma/prisma.service.js';

export interface WorkerAssignmentRow {
  currentProject: NonNullable<WorkerTodayResponse['currentProject']> & {
    telegramChatId?: string | null;
    status?: string;
    employeeFullName?: string;
    organizationId?: string;
  };
  connection?: { id: string; organizationId: string; employeeId: string; projectId: string; authorizationStatus?: string };
  id: string | null;
  startsOn: Date | null;
  endsOn: Date | null;
  site: (WorkerTodayResponse['site'] & { projectId: string }) | null;
  schedule: WorkerTodayResponse['schedule'] | null;
  attendance?: {
    id: string;
    status: string;
    checkInAt: Date | string | null;
    checkOutAt: Date | string | null;
    verification: string | null;
    workDurationMinutes: number | null;
    checkInDistanceMeters?: number | null;
  } | null;
}

/**
 * One parameterized read instead of Prisma's separate relation SELECTs.
 * Tenant predicates cover every joined table, not just the employee.
 * Dates are intentionally resolved by the existing site-timezone evaluator.
 */
export function readWorkerAssignments(prisma: PrismaService, worker: WorkerPrincipal) {
  return prisma.$queryRaw<WorkerAssignmentRow[]>`
    SELECT json_build_object('id', p.id, 'name', p.name, 'workMode', p."workMode",
      'status', p.status, 'organizationId', p."organizationId", 'telegramChatId', p."telegramChatId", 'employeeFullName', e."fullName") AS "currentProject",
      json_build_object('id', c.id, 'organizationId', c."organizationId", 'employeeId', c."employeeId", 'projectId', c."projectId", 'authorizationStatus', c."authorizationStatus") AS connection,
      a.id, a."startsOn", a."endsOn",
      CASE WHEN s.id IS NOT NULL THEN json_build_object(
        'id', s.id, 'name', s.name, 'projectId', s."projectId",
        'latitude', s.latitude, 'longitude', s.longitude,
        'allowedRadiusMeters', s."allowedRadiusMeters", 'timezone', s.timezone
      ) END AS site,
      CASE WHEN w.id IS NOT NULL THEN json_build_object(
        'id', w.id, 'name', w.name, 'startTime', w."startTime",
        'endTime', w."endTime", 'graceMinutes', w."graceMinutes"
      ) END AS schedule,
      CASE WHEN ar.id IS NOT NULL THEN json_build_object(
        'id', ar.id, 'status', ar.status,
        'checkInAt', ar."checkInAt" AT TIME ZONE 'UTC', 'checkOutAt', ar."checkOutAt" AT TIME ZONE 'UTC',
        'verification', ar."checkInVerification", 'workDurationMinutes', ar."workDurationMinutes",
        'checkInDistanceMeters', ar."checkInDistanceMeters"
      ) END AS attendance
    FROM "Employee" e
    JOIN "Project" p ON p.id = e."currentProjectId"
      AND p."organizationId" = e."organizationId" AND p.status = 'ACTIVE'
    JOIN "WorkerProject" c ON c."employeeId" = e.id AND c."projectId" = p.id
      AND c."organizationId" = e."organizationId"
    LEFT JOIN (
      "Assignment" a
      JOIN "Site" s ON s.id = a."siteId" AND s."organizationId" = a."organizationId" AND s.status = 'ACTIVE'
      JOIN "Project" ap ON ap.id = s."projectId" AND ap."organizationId" = a."organizationId" AND ap.status = 'ACTIVE'
      JOIN "WorkSchedule" w ON w.id = a."scheduleId" AND w."organizationId" = a."organizationId"
      LEFT JOIN "AttendanceRecord" ar ON ar."assignmentId" = a.id
        AND ar."organizationId" = a."organizationId"
        AND ar."employeeId" = a."employeeId"
        AND ar."attendanceDate" = (now() AT TIME ZONE COALESCE(s.timezone, 'Asia/Phnom_Penh'))::date
    ) ON a."employeeId" = e.id AND a."organizationId" = e."organizationId" AND a.status = 'ACTIVE'
    WHERE e.id = ${worker.employeeId} AND e."organizationId" = ${worker.organizationId} AND e.status = 'ACTIVE'
  `;
}

export interface OpenAttendanceRow {
  id: string;
  organizationId: string;
  employeeId: string;
  projectId: string;
  telegramChatId: string | null;
  checkInAt: Date;
  employeeFullName: string;
  project: { id: string; organizationId: string; name: string; status: string; telegramChatId: string | null; workMode: string };
  connection: { id: string; organizationId: string; employeeId: string; projectId: string; authorizationStatus?: string } | null;
  assignment: {
    site: NonNullable<WorkerAssignmentRow['site']>;
    schedule: NonNullable<WorkerAssignmentRow['schedule']>;
  };
}

/** The checkout remains tied to the original attendance project after a project switch. */
export async function readOpenAttendance(prisma: PrismaService, worker: WorkerPrincipal): Promise<OpenAttendanceRow | null> {
  const rows = await prisma.$queryRaw<OpenAttendanceRow[]>`
    SELECT r.id, r."organizationId", r."employeeId", r."projectId", r."telegramChatId", r."checkInAt",
      e."fullName" AS "employeeFullName",
      json_build_object('id', p.id, 'organizationId', p."organizationId", 'name', p.name, 'status', p.status,
        'telegramChatId', p."telegramChatId", 'workMode', p."workMode") AS project,
      CASE WHEN c.id IS NOT NULL THEN json_build_object('id', c.id, 'organizationId', c."organizationId",
        'employeeId', c."employeeId", 'projectId', c."projectId", 'authorizationStatus', c."authorizationStatus") END AS connection,
      json_build_object('site', json_build_object('id', s.id, 'name', s.name, 'projectId', s."projectId",
        'latitude', s.latitude, 'longitude', s.longitude, 'allowedRadiusMeters', s."allowedRadiusMeters", 'timezone', s.timezone),
        'schedule', json_build_object('id', w.id, 'name', w.name, 'startTime', w."startTime",
        'endTime', w."endTime", 'graceMinutes', w."graceMinutes")) AS assignment
    FROM "AttendanceRecord" r
    JOIN "Employee" e ON e.id = r."employeeId" AND e."organizationId" = r."organizationId"
    JOIN "Project" p ON p.id = r."projectId" AND p."organizationId" = r."organizationId"
    JOIN "Assignment" a ON a.id = r."assignmentId" AND a."organizationId" = r."organizationId" AND a."employeeId" = r."employeeId"
    JOIN "Site" s ON s.id = a."siteId" AND s."organizationId" = r."organizationId"
    JOIN "WorkSchedule" w ON w.id = a."scheduleId" AND w."organizationId" = r."organizationId"
    LEFT JOIN "WorkerProject" c ON c."employeeId" = r."employeeId" AND c."projectId" = r."projectId" AND c."organizationId" = r."organizationId"
    WHERE r."organizationId" = ${worker.organizationId} AND r."employeeId" = ${worker.employeeId}
      AND r."checkInAt" IS NOT NULL AND r."checkOutAt" IS NULL
    ORDER BY r."checkInAt" DESC LIMIT 1
  `;
  return rows[0] ?? null;
}

export interface AttendanceReplay {
  id: string;
  status: AttendanceActionResponse['status'];
  timestamp: Date;
  verification: NonNullable<WorkerTodayResponse['attendance']>['verification'];
  distanceMeters: number;
  workDurationMinutes: number | null;
}

export async function readAttendanceReplay(prisma: PrismaService, worker: WorkerPrincipal, action: 'CHECK_IN' | 'CHECK_OUT', key: string) {
  const rows = await prisma.$queryRaw<AttendanceReplay[]>`
    SELECT r.id, r.status, r."workDurationMinutes",
      CASE WHEN ${action} = 'CHECK_IN' THEN COALESCE(r."checkInAt", r."createdAt") ELSE COALESCE(r."checkOutAt", r."updatedAt") END AS timestamp,
      CASE WHEN ${action} = 'CHECK_IN' THEN r."checkInVerification" ELSE r."checkOutVerification" END AS verification,
      CASE WHEN ${action} = 'CHECK_IN' THEN COALESCE(r."checkInDistanceMeters", 0) ELSE COALESCE(r."checkOutDistanceMeters", 0) END AS "distanceMeters"
    FROM "AttendanceRequest" q
    JOIN "AttendanceRecord" r ON r.id = q."attendanceRecordId" AND r."organizationId" = q."organizationId" AND r."employeeId" = q."employeeId"
    WHERE q."organizationId" = ${worker.organizationId} AND q."employeeId" = ${worker.employeeId}
      AND q.action = ${action}::"AttendanceAction" AND q."idempotencyKey" = ${key}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export function readConnectedProjects(prisma: PrismaService, worker: WorkerPrincipal) {
  return prisma.$queryRaw<WorkerConnectedProject[]>`
    SELECT p.id, p.name, p."workMode", COALESCE(p.id = e."currentProjectId", false) AS "isCurrent"
    FROM "WorkerProject" c
    JOIN "Employee" e ON e.id = c."employeeId" AND e."organizationId" = c."organizationId" AND e.status = 'ACTIVE'
    JOIN "Project" p ON p.id = c."projectId" AND p."organizationId" = c."organizationId" AND p.status = 'ACTIVE'
    WHERE c."employeeId" = ${worker.employeeId} AND c."organizationId" = ${worker.organizationId}
    ORDER BY c."lastSelectedAt" DESC
  `;
}
