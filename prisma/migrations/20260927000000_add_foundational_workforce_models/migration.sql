CREATE TYPE "CorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "PositionHistorySource" AS ENUM ('MANAGER_ASSIGNED', 'WORKER_REQUEST_APPROVED', 'IMPORT');
CREATE TYPE "PositionRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "RegistrationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "BulkBatchStatus" AS ENUM ('PREVIEW_GENERATED', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "BulkResultStatus" AS ENUM ('CREATED', 'SKIPPED_CONFLICT', 'SKIPPED_INACTIVE', 'FAILED');

ALTER TABLE "Employee"
  ADD COLUMN "normalizedPhone" TEXT,
  ADD COLUMN "avatarUrl" TEXT,
  ADD COLUMN "currentPositionId" TEXT;

ALTER TABLE "TelegramAccount"
  ADD COLUMN "firstName" TEXT,
  ADD COLUMN "lastName" TEXT,
  ADD COLUMN "photoUrl" TEXT;

CREATE TABLE "Position" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "LifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Position_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Position_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "EmployeePositionHistory" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "positionId" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo" TIMESTAMP(3),
  "source" "PositionHistorySource" NOT NULL DEFAULT 'MANAGER_ASSIGNED',
  "assignedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmployeePositionHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmployeePositionHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "EmployeePositionHistory_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "EmployeePositionHistory_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "PositionRequest" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "requestedPositionId" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "PositionRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedAt" TIMESTAMP(3),
  "reviewedByUserId" TEXT,
  "reviewNote" TEXT,
  CONSTRAINT "PositionRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PositionRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PositionRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PositionRequest_requestedPositionId_fkey" FOREIGN KEY ("requestedPositionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "RegistrationRequest" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "telegramUserId" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "normalizedPhone" TEXT NOT NULL,
  "telegramUsername" TEXT,
  "telegramFirstName" TEXT,
  "telegramLastName" TEXT,
  "telegramPhotoUrl" TEXT,
  "status" "RegistrationRequestStatus" NOT NULL DEFAULT 'PENDING',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedByUserId" TEXT,
  "reviewNote" TEXT,
  "createdEmployeeId" TEXT,
  CONSTRAINT "RegistrationRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RegistrationRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "WorkerGroup" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "LifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkerGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkerGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "WorkerGroupMember" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workerGroupId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkerGroupMember_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkerGroupMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkerGroupMember_workerGroupId_fkey" FOREIGN KEY ("workerGroupId") REFERENCES "WorkerGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkerGroupMember_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "BulkAssignmentBatch" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "targetSiteId" TEXT NOT NULL,
  "scheduleId" TEXT NOT NULL,
  "startsOn" DATE NOT NULL,
  "endsOn" DATE,
  "requestedByUserId" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "previewId" TEXT NOT NULL,
  "previewExpiresAt" TIMESTAMP(3) NOT NULL,
  "snapshotWorkerIds" JSONB NOT NULL,
  "transferOption" BOOLEAN NOT NULL DEFAULT false,
  "status" "BulkBatchStatus" NOT NULL DEFAULT 'PREVIEW_GENERATED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BulkAssignmentBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BulkAssignmentBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BulkAssignmentBatch_targetSiteId_fkey" FOREIGN KEY ("targetSiteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BulkAssignmentBatch_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "WorkSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BulkAssignmentBatch_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "BulkAssignmentResult" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "status" "BulkResultStatus" NOT NULL,
  "reasonCode" TEXT,
  "safeMessage" TEXT,
  "assignmentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BulkAssignmentResult_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BulkAssignmentResult_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BulkAssignmentBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BulkAssignmentResult_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BulkAssignmentResult_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "AttendanceCorrection" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "attendanceRecordId" TEXT NOT NULL,
  "requestedByUserId" TEXT,
  "approvedByUserId" TEXT,
  "status" "CorrectionStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT NOT NULL,
  "correctedCheckInAt" TIMESTAMP(3),
  "correctedCheckOutAt" TIMESTAMP(3),
  "correctedStatus" "AttendanceStatus",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "AttendanceCorrection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttendanceCorrection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AttendanceCorrection_attendanceRecordId_fkey" FOREIGN KEY ("attendanceRecordId") REFERENCES "AttendanceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "Employee" ADD CONSTRAINT "Employee_currentPositionId_fkey" FOREIGN KEY ("currentPositionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Employee_organizationId_normalizedPhone_key" ON "Employee"("organizationId", "normalizedPhone");
CREATE INDEX "Employee_organizationId_currentPositionId_status_idx" ON "Employee"("organizationId", "currentPositionId", "status");
CREATE UNIQUE INDEX "Position_organizationId_code_key" ON "Position"("organizationId", "code");
CREATE INDEX "Position_organizationId_status_idx" ON "Position"("organizationId", "status");
CREATE INDEX "EmployeePositionHistory_organizationId_employeeId_effectiveFrom_idx" ON "EmployeePositionHistory"("organizationId", "employeeId", "effectiveFrom");
CREATE INDEX "EmployeePositionHistory_organizationId_positionId_idx" ON "EmployeePositionHistory"("organizationId", "positionId");
CREATE INDEX "PositionRequest_organizationId_status_requestedAt_idx" ON "PositionRequest"("organizationId", "status", "requestedAt");
CREATE INDEX "PositionRequest_organizationId_employeeId_idx" ON "PositionRequest"("organizationId", "employeeId");
CREATE INDEX "RegistrationRequest_organizationId_status_requestedAt_idx" ON "RegistrationRequest"("organizationId", "status", "requestedAt");
CREATE INDEX "RegistrationRequest_organizationId_normalizedPhone_idx" ON "RegistrationRequest"("organizationId", "normalizedPhone");
CREATE INDEX "RegistrationRequest_organizationId_telegramUserId_idx" ON "RegistrationRequest"("organizationId", "telegramUserId");
CREATE UNIQUE INDEX "WorkerGroup_organizationId_code_key" ON "WorkerGroup"("organizationId", "code");
CREATE INDEX "WorkerGroup_organizationId_status_idx" ON "WorkerGroup"("organizationId", "status");
CREATE INDEX "WorkerGroupMember_organizationId_workerGroupId_leftAt_idx" ON "WorkerGroupMember"("organizationId", "workerGroupId", "leftAt");
CREATE INDEX "WorkerGroupMember_organizationId_employeeId_leftAt_idx" ON "WorkerGroupMember"("organizationId", "employeeId", "leftAt");
CREATE UNIQUE INDEX "BulkAssignmentBatch_previewId_key" ON "BulkAssignmentBatch"("previewId");
CREATE UNIQUE INDEX "BulkAssignmentBatch_organizationId_requestedByUserId_idempotencyKey_key" ON "BulkAssignmentBatch"("organizationId", "requestedByUserId", "idempotencyKey");
CREATE INDEX "BulkAssignmentBatch_organizationId_createdAt_idx" ON "BulkAssignmentBatch"("organizationId", "createdAt");
CREATE INDEX "BulkAssignmentResult_batchId_status_idx" ON "BulkAssignmentResult"("batchId", "status");
CREATE INDEX "AttendanceCorrection_organizationId_status_idx" ON "AttendanceCorrection"("organizationId", "status");
CREATE INDEX "AttendanceCorrection_attendanceRecordId_idx" ON "AttendanceCorrection"("attendanceRecordId");
