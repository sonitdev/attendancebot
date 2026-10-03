ALTER INDEX "AttendanceRecord_organizationId_employeeId_checkOutAt_checkInAt"
  RENAME TO "AttendanceRecord_organizationId_employeeId_checkOutAt_check_idx";

ALTER INDEX "BulkAssignmentBatch_organizationId_requestedByUserId_idempotenc"
  RENAME TO "BulkAssignmentBatch_organizationId_requestedByUserId_idempo_key";

ALTER INDEX "EmployeePositionHistory_organizationId_employeeId_effectiveFrom"
  RENAME TO "EmployeePositionHistory_organizationId_employeeId_effective_idx";

ALTER TABLE "Project" ALTER COLUMN "updatedAt" DROP DEFAULT;

DROP INDEX "TelegramReportGroup_siteId_idx";
DROP INDEX "TelegramReportGroup_workerGroupId_idx";
