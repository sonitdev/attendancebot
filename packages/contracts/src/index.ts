import { z } from 'zod';

export { km } from './km.js';

export const attendanceVerificationStatuses = [
  'VERIFIED',
  'OUTSIDE_GEOFENCE',
  'LOW_ACCURACY',
  'LOCATION_UNAVAILABLE',
  'MANAGER_REVIEW',
  'MANAGER_OVERRIDE',
] as const;

export const attendanceStatuses = [
  'NOT_STARTED',
  'ON_TIME',
  'LATE',
  'ABSENT',
  'APPROVED_LEAVE',
  'EARLY_CHECKOUT',
  'MISSING_CHECKOUT',
  'OUTSIDE_GEOFENCE',
  'LOW_ACCURACY',
  'PENDING_REVIEW',
  'COMPLETED',
] as const;

export type AttendanceVerificationStatus = (typeof attendanceVerificationStatuses)[number];
export type AttendanceStatus = (typeof attendanceStatuses)[number];

// Location input for check-in / check-out
export const attendanceLocationSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().positive().max(10_000),
  capturedAt: z.string().datetime({ offset: true }).optional(),
  deviceContext: z
    .object({ platform: z.string().max(80).optional(), appVersion: z.string().max(80).optional() })
    .strict()
    .optional(),
}).strict();

export type AttendanceLocationInput = z.infer<typeof attendanceLocationSchema>;

export const attendanceCheckInSchema = attendanceLocationSchema.extend({
  proofPhotoDataUrl: z
    .string()
    .regex(/^data:image\/(jpeg|webp);base64,/, 'INVALID_PROOF_PHOTO')
    .max(3_000_000, 'PROOF_PHOTO_TOO_LARGE'),
}).strict();

export type AttendanceCheckInInput = z.infer<typeof attendanceCheckInSchema>;
export const recordVisitSchema = attendanceCheckInSchema.extend({
  outletId: z.string().min(1).optional(),
  customerName: z.string().trim().min(1).max(120).optional(),
  note: z.string().trim().min(1).max(500).optional(),
  visitResult: z.string().trim().min(1).max(500).optional(),
  followUpRequired: z.boolean().optional(),
  followUpAt: z.string().datetime({ offset: true }).optional(),
  potentialOrderQuantity: z.number().int().positive().max(1_000_000).optional(),
  requestedDiscountPerItem: z.number().nonnegative().max(1_000_000).optional(),
}).strict();
export type RecordVisitInput = z.infer<typeof recordVisitSchema>;

// Telegram Session
export const telegramSessionSchema = z.object({
  initData: z.string().min(1).max(8_192),
}).strict();

export const telegramSessionResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  employee: z.object({
    id: z.string(),
    employeeCode: z.string(),
    fullName: z.string(),
    avatarUrl: z.string().nullable().optional(),
    currentPosition: z
      .object({
        id: z.string(),
        code: z.string(),
        name: z.string(),
      })
      .nullable()
      .optional(),
  }),
  organization: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
  }),
}).strict();

export type TelegramSessionInput = z.infer<typeof telegramSessionSchema>;
export type TelegramSessionResponse = z.infer<typeof telegramSessionResponseSchema>;

// Admin Setup Schemas
export const createEmployeeSchema = z.object({
  employeeCode: z.string().min(1).max(50),
  fullName: z.string().min(1).max(100),
  phone: z.string().max(30).optional(),
  jobTitle: z.string().max(100).optional(),
  avatarUrl: z.string().url().max(500).optional(),
}).strict();

export const createProjectSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  workMode: z.enum(['SITE', 'SALES']).default('SITE'),
}).strict();

export const createSiteSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(100),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  allowedRadiusMeters: z.number().int().positive().max(50_000),
  timezone: z.string().min(1).max(100),
}).strict();

export const createWorkScheduleSchema = z.object({
  name: z.string().min(1).max(100),
  timezone: z.string().min(1).max(100),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid time format HH:mm'),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid time format HH:mm'),
  graceMinutes: z.number().int().min(0).max(120).default(0),
}).strict();

export const createAssignmentSchema = z.object({
  employeeId: z.string().min(1),
  siteId: z.string().min(1),
  scheduleId: z.string().min(1),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
}).strict();

export const linkTelegramSchema = z.object({
  employeeId: z.string().min(1),
  telegramUserId: z.string().min(1).max(50),
  username: z.string().max(100).optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  photoUrl: z.string().url().max(500).optional(),
}).strict();

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreateSiteInput = z.infer<typeof createSiteSchema>;
export type CreateWorkScheduleInput = z.infer<typeof createWorkScheduleSchema>;
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;
export type LinkTelegramInput = z.infer<typeof linkTelegramSchema>;

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  code: z.string().min(1).max(50).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'ARCHIVED']).optional(),
  workMode: z.enum(['SITE', 'SALES']).optional(),
}).strict();

export const updateSiteSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
  allowedRadiusMeters: z.number().int().positive().max(50_000).optional(),
  timezone: z.string().min(1).max(100).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
}).strict();

export const updateEmployeeSchema = z.object({
  fullName: z.string().min(1).max(100).optional(),
  phone: z.string().max(30).optional(),
  jobTitle: z.string().max(100).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
}).strict();

export const updateWorkScheduleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  timezone: z.string().min(1).max(100).optional(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid time format HH:mm').optional(),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid time format HH:mm').optional(),
  graceMinutes: z.number().int().min(0).max(120).optional(),
}).strict();

export const updateAssignmentSchema = z.object({
  siteId: z.string().min(1).optional(),
  scheduleId: z.string().min(1).optional(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['ACTIVE', 'CANCELLED', 'COMPLETED']).optional(),
}).strict();

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type UpdateSiteInput = z.infer<typeof updateSiteSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type UpdateWorkScheduleInput = z.infer<typeof updateWorkScheduleSchema>;
export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;

export const updateOrganizationSettingsSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  logoUrl: z.string().url().max(1_000).nullable().optional(),
  brandPrimaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  brandAccentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  defaultLocale: z.enum(['en', 'km']).optional(),
}).strict();

export const uploadOrganizationLogoSchema = z.object({
  imageDataUrl: z.string().regex(/^data:image\/(png|jpeg|webp|svg\+xml);base64,/).max(4_000_000),
}).strict();

export type UpdateOrganizationSettingsInput = z.infer<typeof updateOrganizationSettingsSchema>;

export const replaceAdminScopesSchema = z.object({
  projectIds: z.array(z.string().min(1)).max(500),
  siteIds: z.array(z.string().min(1)).max(500),
}).strict();

export type ReplaceAdminScopesInput = z.infer<typeof replaceAdminScopesSchema>;

// Worker Today Response
export const workerTodayResponseSchema = z.object({
  date: z.string(),
  siteTimezone: z.string(),
  currentProject: z.object({
    id: z.string(),
    name: z.string(),
    workMode: z.enum(['SITE', 'SALES']),
  }),
  assignment: z.object({
    id: z.string(),
    startsOn: z.string(),
    endsOn: z.string().nullable(),
  }),
  site: z.object({
    id: z.string(),
    name: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    allowedRadiusMeters: z.number(),
    timezone: z.string(),
  }),
  schedule: z.object({
    id: z.string(),
    name: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    graceMinutes: z.number(),
  }),
  attendance: z
    .object({
      id: z.string(),
      status: z.enum(attendanceStatuses),
      checkInAt: z.string().nullable(),
      checkOutAt: z.string().nullable(),
      verification: z.enum(attendanceVerificationStatuses).nullable(),
      workDurationMinutes: z.number().nullable(),
    })
    .nullable(),
}).strict();

export type WorkerTodayResponse = z.infer<typeof workerTodayResponseSchema>;

export const setCurrentProjectSchema = z.object({ projectId: z.string().min(1) }).strict();
export type SetCurrentProjectInput = z.infer<typeof setCurrentProjectSchema>;
export interface WorkerConnectedProject { id: string; name: string; workMode: 'SITE' | 'SALES'; isCurrent: boolean; }

export interface WorkerSalesOutlet {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
}

export interface WorkerSalesVisit {
  id: string;
  outlet: { id: string; name: string } | null;
  customerName: string | null;
  visitedAt: string;
  note: string | null;
  visitResult: string | null;
  followUpRequired: boolean;
  followUpAt?: string | null;
  potentialOrderQuantity?: number | null;
  requestedDiscountPerItem?: number | null;
  workerStatement: string | null;
  structuredContext?: Record<string, unknown> | null;
  needsContext: boolean;
}

export interface WorkerSalesDay {
  id: string;
  status: string;
  reportDate: string;
  project: { id: string; name: string };
  attendance: { checkInAt: string | null; checkOutAt: string | null; status: string };
  workerSummary: string | null;
  additionalNote: string | null;
  submittedAt: string | null;
  visits: WorkerSalesVisit[];
}

export const createOutletSchema = z.object({
  projectId: z.string().min(1),
  code: z.string().trim().max(50).optional(),
  name: z.string().trim().min(1).max(120),
  contactName: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(500).optional(),
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
}).strict();

export const updateOutletSchema = createOutletSchema.partial().extend({
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
}).strict();

export const updateSalesVisitContextSchema = z.object({
  workerStatement: z.string().trim().min(1).max(2_000),
  visitResult: z.string().trim().max(500).optional(),
  followUpRequired: z.boolean().optional(),
  followUpAt: z.string().datetime({ offset: true }).optional(),
  potentialOrderQuantity: z.number().int().positive().max(1_000_000).optional(),
  requestedDiscountPerItem: z.number().nonnegative().max(1_000_000).optional(),
}).strict();

export const updateDailySalesReportSchema = z.object({
  workerSummary: z.string().trim().max(4_000).optional(),
  additionalNote: z.string().trim().max(4_000).optional(),
}).strict();

export type CreateOutletInput = z.infer<typeof createOutletSchema>;
export type UpdateOutletInput = z.infer<typeof updateOutletSchema>;
export type UpdateSalesVisitContextInput = z.infer<typeof updateSalesVisitContextSchema>;
export type UpdateDailySalesReportInput = z.infer<typeof updateDailySalesReportSchema>;

// Attendance Action (Check-in / Check-out) Response
export const attendanceActionResponseSchema = z.object({
  attendanceId: z.string(),
  action: z.enum(['CHECK_IN', 'CHECK_OUT']),
  status: z.enum(attendanceStatuses),
  verificationResult: z.enum(attendanceVerificationStatuses),
  timestamp: z.string(),
  distanceMeters: z.number(),
  workDurationMinutes: z.number().nullable(),
  message: z.string(),
}).strict();

export type AttendanceActionResponse = z.infer<typeof attendanceActionResponseSchema>;

// Admin Attendance Today Query
export const adminAttendanceQuerySchema = z.object({
  siteId: z.string().optional(),
  projectId: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type AdminAttendanceQuery = z.infer<typeof adminAttendanceQuerySchema>;

// Analytics & Cross-Project Performance Schemas
export const projectPerformanceSummarySchema = z.object({
  projectId: z.string(),
  projectCode: z.string(),
  projectName: z.string(),
  shiftsCompleted: z.number(),
  totalWorkMinutes: z.number(),
  totalWorkHours: z.number(),
  onTimePercentage: z.number(),
  lastAttendedDate: z.string().nullable(),
});

export const attendanceHistoryItemSchema = z.object({
  id: z.string(),
  attendanceDate: z.string(),
  projectName: z.string(),
  siteName: z.string(),
  checkInAt: z.string().nullable(),
  checkOutAt: z.string().nullable(),
  status: z.enum(attendanceStatuses),
  verification: z.enum(attendanceVerificationStatuses).nullable(),
  workDurationMinutes: z.number().nullable(),
});

export const weeklyAttendanceDaySchema = z.object({
  date: z.string(),
  dayName: z.string(),
  dayNumber: z.number(),
  hoursWorked: z.number(),
  targetHours: z.number(),
  status: z.string(),
  checkInAt: z.string().nullable(),
  checkOutAt: z.string().nullable(),
  isToday: z.boolean(),
});

export const weeklyPerformanceStatsSchema = z.object({
  totalHours: z.number(),
  targetHours: z.number(),
  onTimeRate: z.number(),
  shiftsCount: z.number(),
});

export const activeProjectPreviewSchema = z.object({
  projectId: z.string(),
  projectCode: z.string(),
  projectName: z.string(),
  siteName: z.string(),
  allowedRadiusMeters: z.number(),
  scheduleTime: z.string(),
  startsOn: z.string(),
}).nullable();

export const employeePerformanceAnalyticsSchema = z.object({
  employee: z.object({
    id: z.string(),
    employeeCode: z.string(),
    fullName: z.string(),
    jobTitle: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    telegramUsername: z.string().nullable(),
  }),
  summary: z.object({
    totalShifts: z.number(),
    totalWorkMinutes: z.number(),
    totalWorkHours: z.number(),
    onTimeCount: z.number(),
    lateCount: z.number(),
    onTimePercentage: z.number(),
    verifiedCount: z.number(),
    exceptionCount: z.number(),
  }),
  projectBreakdown: z.array(projectPerformanceSummarySchema),
  recentHistory: z.array(attendanceHistoryItemSchema),
  weeklyAttendance: z.array(weeklyAttendanceDaySchema).optional(),
  weeklyStats: weeklyPerformanceStatsSchema.optional(),
  activeProject: activeProjectPreviewSchema.optional(),
});

export type ProjectPerformanceSummary = z.infer<typeof projectPerformanceSummarySchema>;
export type AttendanceHistoryItem = z.infer<typeof attendanceHistoryItemSchema>;
export type WeeklyAttendanceDay = z.infer<typeof weeklyAttendanceDaySchema>;
export type WeeklyPerformanceStats = z.infer<typeof weeklyPerformanceStatsSchema>;
export type ActiveProjectPreview = z.infer<typeof activeProjectPreviewSchema>;
export type EmployeePerformanceAnalytics = z.infer<typeof employeePerformanceAnalyticsSchema>;

// Admin Authentication Schemas
export const adminLoginSchema = z.object({
  email: z.string().email().max(100),
  orgSlug: z.string().min(1).max(100),
  password: z.string().min(12).max(128),
}).strict();

export const adminRegistrationSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  orgSlug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(2).max(60),
  email: z.string().trim().toLowerCase().email().max(100),
  password: z.string().min(12).max(128),
}).strict();

export const adminSessionResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string(),
    roles: z.array(z.string()),
  }),
  organization: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
  }),
}).strict();

export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
export type AdminRegistrationInput = z.infer<typeof adminRegistrationSchema>;
export type AdminSessionResponse = z.infer<typeof adminSessionResponseSchema>;

// Admin Workforce & Site Types
export interface EmployeeListItem {
  id: string;
  employeeCode: string;
  fullName: string;
  jobTitle: string | null;
  phone: string | null;
  avatarUrl: string | null;
  status: string;
  currentPosition?: {
    id: string;
    code: string;
    name: string;
  } | null;
  telegramAccount: {
    id: string;
    telegramUserId: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    photoUrl: string | null;
    status: string;
    lastVerifiedAt: string | null;
  } | null;
}

export interface ProjectListItem {
  id: string;
  code: string;
  name: string;
  status: string;
  workMode: string;
  telegramChatId: string | null;
  telegramConnectionStatus: string;
  telegramHealthCheckedAt: string | null;
  telegramHealthError: string | null;
  sitesCount: number;
}

export interface SiteListItem {
  id: string;
  projectId: string;
  projectName?: string;
  name: string;
  latitude: number;
  longitude: number;
  allowedRadiusMeters: number;
  timezone: string;
  status: string;
}

export interface WorkScheduleListItem {
  id: string;
  name: string;
  timezone: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
}

export interface AssignmentListItem {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  siteId: string;
  siteName: string;
  projectId: string;
  projectName: string;
  scheduleId: string;
  scheduleName: string;
  startsOn: string;
  endsOn: string | null;
  status: string;
}

export interface AuditLogListItem {
  id: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// Phase 5: Corrections & Exceptions
export const correctionStatuses = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type CorrectionStatus = (typeof correctionStatuses)[number];

export const createCorrectionSchema = z.object({
  reason: z.string().trim().min(5, 'Reason must be at least 5 characters').max(500),
  correctedCheckInAt: z.string().datetime({ offset: true }).optional(),
  correctedCheckOutAt: z.string().datetime({ offset: true }).optional(),
  correctedStatus: z.enum(attendanceStatuses).optional(),
  correctedProjectId: z.string().min(1).optional(),
}).strict();

export const resolveCorrectionSchema = z.object({
  approved: z.boolean(),
  note: z.string().trim().max(500).optional(),
}).strict();

export const attendanceExportQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  siteId: z.string().optional(),
  projectId: z.string().optional(),
  employeeId: z.string().optional(),
  exceptionsOnly: z.coerce.boolean().optional(),
  format: z.enum(['csv', 'json']).default('json'),
});

export type CreateCorrectionInput = z.infer<typeof createCorrectionSchema>;
export type ResolveCorrectionInput = z.infer<typeof resolveCorrectionSchema>;
export type AttendanceExportQuery = z.infer<typeof attendanceExportQuerySchema>;

export interface AttendanceCorrectionItem {
  id: string;
  attendanceRecordId: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  siteName: string;
  attendanceDate: string;
  originalCheckInAt: string | null;
  originalCheckOutAt: string | null;
  originalStatus: AttendanceStatus;
  status: CorrectionStatus;
  reason: string;
  correctedCheckInAt: string | null;
  correctedCheckOutAt: string | null;
  correctedStatus: AttendanceStatus | null;
  originalProjectId: string | null;
  correctedProjectId: string | null;
  requestedByUserId: string | null;
  approvedByUserId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AttendanceExceptionItem {
  id: string;
  attendanceDate: string;
  employee: {
    id: string;
    employeeCode: string;
    fullName: string;
    avatarUrl: string | null;
  };
  site: {
    id: string;
    name: string;
    timezone: string;
  };
  project: {
    id: string;
    name: string;
    code: string;
  };
  schedule: {
    name: string;
    startTime: string;
    endTime: string;
  };
  status: AttendanceStatus;
  checkInAt: string | null;
  checkOutAt: string | null;
  checkInLatitude: number | null;
  checkInLongitude: number | null;
  checkInAccuracyMeters: number | null;
  checkInDistanceMeters: number | null;
  checkInVerification: AttendanceVerificationStatus | null;
  checkOutDistanceMeters: number | null;
  workDurationMinutes: number | null;
  corrections: AttendanceCorrectionItem[];
}

export interface AttendanceExportRow {
  recordId: string;
  attendanceDate: string;
  employeeCode: string;
  employeeName: string;
  projectCode: string;
  projectName: string;
  siteName: string;
  siteTimezone: string;
  scheduledStart: string;
  scheduledEnd: string;
  checkInLocalTime: string | null;
  checkOutLocalTime: string | null;
  workDurationMinutes: number | null;
  workHoursFormatted: string;
  status: AttendanceStatus;
  checkInVerification: AttendanceVerificationStatus | null;
  checkInDistanceMeters: number | null;
  hasCorrections: boolean;
}

// Phase 1: Position Schemas & Types
export const createPositionSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
}).strict();

export const updatePositionSchema = z.object({
  code: z.string().trim().min(1).max(50).optional(),
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
}).strict();

export const assignPositionSchema = z.object({
  positionId: z.string().min(1),
  effectiveFrom: z.string().datetime({ offset: true }).optional(),
}).strict();

export type CreatePositionInput = z.infer<typeof createPositionSchema>;
export type UpdatePositionInput = z.infer<typeof updatePositionSchema>;
export type AssignPositionInput = z.infer<typeof assignPositionSchema>;

export interface PositionListItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeePositionHistoryItem {
  id: string;
  employeeId: string;
  positionId: string;
  positionCode: string;
  positionName: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  source: string;
  assignedByUserId: string | null;
  createdAt: string;
}

// Phase 3: Position Request Schemas & Types
export const createPositionRequestSchema = z.object({
  requestedPositionId: z.string().min(1),
}).strict();

export const resolvePositionRequestSchema = z.object({
  approved: z.boolean(),
  reviewNote: z.string().trim().max(500).optional(),
}).strict();

export type CreatePositionRequestInput = z.infer<typeof createPositionRequestSchema>;
export type ResolvePositionRequestInput = z.infer<typeof resolvePositionRequestSchema>;

export interface PositionRequestListItem {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  requestedPositionId: string;
  requestedPositionCode: string;
  requestedPositionName: string;
  requestedAt: string;
  status: string;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  reviewNote: string | null;
}

// Phase 4: Worker Group Schemas & Types
export const createWorkerGroupSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
}).strict();

export const updateWorkerGroupSchema = z.object({
  code: z.string().trim().min(1).max(50).optional(),
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
}).strict();

export const manageWorkerGroupMembersSchema = z.object({
  employeeIds: z.array(z.string().min(1)).min(1),
}).strict();

export type CreateWorkerGroupInput = z.infer<typeof createWorkerGroupSchema>;
export type UpdateWorkerGroupInput = z.infer<typeof updateWorkerGroupSchema>;
export type ManageWorkerGroupMembersInput = z.infer<typeof manageWorkerGroupMembersSchema>;

export interface WorkerGroupListItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
  activeMembersCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerGroupMemberItem {
  id: string;
  workerGroupId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  joinedAt: string;
  leftAt: string | null;
}

// Phase 5: Bulk Assignment Schemas & Types
export const bulkAssignmentPreviewInputSchema = z.object({
  employeeIds: z.array(z.string().min(1)).optional(),
  workerGroupId: z.string().min(1).optional(),
  siteId: z.string().min(1),
  scheduleId: z.string().min(1),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  transferOption: z.boolean().default(false),
}).strict();

export const bulkAssignmentApplyInputSchema = z.object({
  previewId: z.string().min(1),
  idempotencyKey: z.string().trim().min(1).max(100),
}).strict();

export type BulkAssignmentPreviewInput = z.infer<typeof bulkAssignmentPreviewInputSchema>;
export type BulkAssignmentApplyInput = z.infer<typeof bulkAssignmentApplyInputSchema>;

export interface BulkAssignmentResultRow {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  status: 'CREATED' | 'SKIPPED_CONFLICT' | 'SKIPPED_INACTIVE' | 'FAILED';
  reasonCode: string | null;
  safeMessage: string | null;
  assignmentId: string | null;
}

export interface BulkAssignmentPreviewResponse {
  previewId: string;
  previewExpiresAt: string;
  siteName: string;
  scheduleName: string;
  startsOn: string;
  endsOn: string | null;
  transferOption: boolean;
  summary: {
    totalTargetWorkers: number;
    readyCount: number;
    conflictCount: number;
    inactiveCount: number;
  };
  results: BulkAssignmentResultRow[];
}

export interface BulkAssignmentApplyResponse {
  batchId: string;
  status: string;
  totalProcessed: number;
  createdCount: number;
  skippedCount: number;
  message: string;
}

// Registration Request Schemas & Types
export const resolveRegistrationRequestSchema = z.object({
  approved: z.boolean(),
  employeeCode: z.string().trim().min(1).max(50).optional(),
  fullName: z.string().trim().min(1).max(100).optional(),
  positionId: z.string().min(1).optional(),
  reviewNote: z.string().trim().max(500).optional(),
}).strict();

export type ResolveRegistrationRequestInput = z.infer<typeof resolveRegistrationRequestSchema>;

export interface RegistrationRequestListItem {
  id: string;
  telegramUserId: string;
  phone: string;
  normalizedPhone: string;
  telegramUsername: string | null;
  telegramFirstName: string | null;
  telegramLastName: string | null;
  telegramPhotoUrl: string | null;
  status: string;
  reviewNote: string | null;
  createdEmployeeId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const updateTelegramReportGroupSchema = z.object({
  targetType: z.enum(['SITE', 'WORKER_GROUP', 'NONE']),
  targetId: z.string().min(1).optional(),
  enabled: z.boolean(),
}).strict().superRefine((value, ctx) => {
  if (value.targetType !== 'NONE' && !value.targetId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetId'], message: 'TARGET_REQUIRED' });
  if (value.targetType === 'NONE' && value.enabled) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['enabled'], message: 'TARGET_REQUIRED_TO_ENABLE' });
});
export type UpdateTelegramReportGroupInput = z.infer<typeof updateTelegramReportGroupSchema>;
export interface TelegramReportGroupListItem {
  id: string; title: string | null; status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'; connectedAt: string;
  targetType: 'SITE' | 'WORKER_GROUP' | null; targetId: string | null; targetName: string | null;
}
