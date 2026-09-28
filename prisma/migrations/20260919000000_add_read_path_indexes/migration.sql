-- Keep administrative and worker read paths bounded as tenant data grows.
CREATE INDEX "Project_organizationId_status_idx" ON "Project"("organizationId", "status");

CREATE INDEX "Assignment_organizationId_employeeId_status_startsOn_endsOn_idx"
ON "Assignment"("organizationId", "employeeId", "status", "startsOn", "endsOn");

CREATE INDEX "AttendanceRecord_organizationId_employeeId_checkOutAt_checkInAt_idx"
ON "AttendanceRecord"("organizationId", "employeeId", "checkOutAt", "checkInAt");
