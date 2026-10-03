CREATE INDEX "AttendanceRecord_organizationId_attendanceDate_status_idx"
ON "AttendanceRecord"("organizationId", "attendanceDate", "status");

CREATE INDEX "AttendanceRecord_organizationId_attendanceDate_adjustedStatus_idx"
ON "AttendanceRecord"("organizationId", "attendanceDate", "adjustedStatus");

CREATE INDEX "AttendanceRecord_organizationId_adjustedProjectId_attendanceDate_idx"
ON "AttendanceRecord"("organizationId", "adjustedProjectId", "attendanceDate");
