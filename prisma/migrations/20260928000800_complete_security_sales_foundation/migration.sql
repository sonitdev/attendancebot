ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';

ALTER TABLE "Organization"
  ADD COLUMN "logoUrl" TEXT,
  ADD COLUMN "brandPrimaryColor" TEXT NOT NULL DEFAULT '#023F26',
  ADD COLUMN "brandAccentColor" TEXT NOT NULL DEFAULT '#C4D701',
  ADD COLUMN "defaultLocale" TEXT NOT NULL DEFAULT 'km';

ALTER TABLE "Project"
  ADD COLUMN "workMode" TEXT NOT NULL DEFAULT 'SITE',
  ADD COLUMN "telegramConnectionStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "telegramConnectedAt" TIMESTAMP(3),
  ADD COLUMN "telegramHealthCheckedAt" TIMESTAMP(3),
  ADD COLUMN "telegramHealthError" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "WorkerProject"
  ADD COLUMN "authorizationStatus" TEXT NOT NULL DEFAULT 'AUTHORIZED',
  ADD COLUMN "lastVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "lastVerificationResult" TEXT;

ALTER TABLE "AttendanceCorrection"
  ADD COLUMN "originalCheckInAt" TIMESTAMP(3),
  ADD COLUMN "originalCheckOutAt" TIMESTAMP(3),
  ADD COLUMN "originalStatus" "AttendanceStatus",
  ADD COLUMN "originalProjectId" TEXT,
  ADD COLUMN "correctedProjectId" TEXT,
  ADD COLUMN "resolutionNote" TEXT;

ALTER TABLE "AttendanceRecord"
  ADD COLUMN "adjustedCheckInAt" TIMESTAMP(3),
  ADD COLUMN "adjustedCheckOutAt" TIMESTAMP(3),
  ADD COLUMN "adjustedStatus" "AttendanceStatus",
  ADD COLUMN "adjustedProjectId" TEXT;

ALTER TABLE "AttendanceRecord"
  ADD CONSTRAINT "AttendanceRecord_adjustedProjectId_fkey"
  FOREIGN KEY ("adjustedProjectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AttendanceCorrection"
  ADD CONSTRAINT "AttendanceCorrection_correctedProjectId_fkey"
  FOREIGN KEY ("correctedProjectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VisitLog"
  ADD COLUMN "attendanceRecordId" TEXT,
  ADD COLUMN "outletId" TEXT,
  ADD COLUMN "visitResult" TEXT,
  ADD COLUMN "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "followUpAt" TIMESTAMP(3),
  ADD COLUMN "potentialOrderQuantity" INTEGER,
  ADD COLUMN "requestedDiscountPerItem" DECIMAL(12,2);

CREATE TABLE "Outlet" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "code" TEXT,
  "name" TEXT NOT NULL,
  "contactName" TEXT,
  "phone" TEXT,
  "address" TEXT,
  "latitude" DECIMAL(9,6),
  "longitude" DECIMAL(9,6),
  "status" "LifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Outlet_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Outlet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Outlet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Outlet_organizationId_projectId_name_key" ON "Outlet"("organizationId", "projectId", "name");
CREATE INDEX "Outlet_organizationId_projectId_status_idx" ON "Outlet"("organizationId", "projectId", "status");

ALTER TABLE "VisitLog" ADD CONSTRAINT "VisitLog_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VisitLog" ADD CONSTRAINT "VisitLog_attendanceRecordId_fkey" FOREIGN KEY ("attendanceRecordId") REFERENCES "AttendanceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "VisitLog_organizationId_outletId_visitedAt_idx" ON "VisitLog"("organizationId", "outletId", "visitedAt");
CREATE INDEX "VisitLog_attendanceRecordId_visitedAt_idx" ON "VisitLog"("attendanceRecordId", "visitedAt");

CREATE TABLE "DailySalesReport" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "attendanceRecordId" TEXT NOT NULL,
  "reportDate" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "workerSummary" TEXT,
  "additionalNote" TEXT,
  "submittedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailySalesReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DailySalesReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DailySalesReport_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DailySalesReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DailySalesReport_attendanceRecordId_fkey" FOREIGN KEY ("attendanceRecordId") REFERENCES "AttendanceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DailySalesReport_attendanceRecordId_key" ON "DailySalesReport"("attendanceRecordId");
CREATE INDEX "DailySalesReport_organizationId_reportDate_status_idx" ON "DailySalesReport"("organizationId", "reportDate", "status");
CREATE INDEX "DailySalesReport_organizationId_employeeId_reportDate_idx" ON "DailySalesReport"("organizationId", "employeeId", "reportDate");

CREATE TABLE "DailySalesReportVisit" (
  "id" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "visitLogId" TEXT NOT NULL,
  "workerStatement" TEXT,
  "structuredContext" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailySalesReportVisit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DailySalesReportVisit_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DailySalesReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DailySalesReportVisit_visitLogId_fkey" FOREIGN KEY ("visitLogId") REFERENCES "VisitLog"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DailySalesReportVisit_reportId_visitLogId_key" ON "DailySalesReportVisit"("reportId", "visitLogId");
CREATE INDEX "DailySalesReportVisit_reportId_idx" ON "DailySalesReportVisit"("reportId");

CREATE TABLE "TelegramConversationState" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "telegramUserId" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "context" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TelegramConversationState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TelegramConversationState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TelegramConversationState_telegramUserId_key" ON "TelegramConversationState"("telegramUserId");
CREATE INDEX "TelegramConversationState_organizationId_state_expiresAt_idx" ON "TelegramConversationState"("organizationId", "state", "expiresAt");
