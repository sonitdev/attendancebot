-- Supports the tenant/date-bounded Admin attendance list ordered by newest record.
CREATE INDEX "AttendanceRecord_organizationId_attendanceDate_createdAt_idx"
ON "AttendanceRecord" ("organizationId", "attendanceDate", "createdAt");
