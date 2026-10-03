ALTER TABLE "Employee" ADD COLUMN "currentProjectId" TEXT;
ALTER TABLE "Project" ADD COLUMN "telegramChatId" TEXT;
ALTER TABLE "AttendanceRecord" ADD COLUMN "projectId" TEXT, ADD COLUMN "siteId" TEXT, ADD COLUMN "telegramChatId" TEXT;
ALTER TABLE "VisitLog" ADD COLUMN "projectId" TEXT;

CREATE TABLE "WorkerProject" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSelectedAt" TIMESTAMP(3),
  CONSTRAINT "WorkerProject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Project_telegramChatId_key" ON "Project"("telegramChatId");
CREATE UNIQUE INDEX "WorkerProject_employeeId_projectId_key" ON "WorkerProject"("employeeId", "projectId");
CREATE INDEX "WorkerProject_organizationId_employeeId_idx" ON "WorkerProject"("organizationId", "employeeId");
CREATE INDEX "WorkerProject_organizationId_projectId_idx" ON "WorkerProject"("organizationId", "projectId");

UPDATE "AttendanceRecord" AS ar
SET "projectId" = s."projectId", "siteId" = a."siteId", "telegramChatId" = p."telegramChatId"
FROM "Assignment" AS a
JOIN "Site" AS s ON s."id" = a."siteId"
JOIN "Project" AS p ON p."id" = s."projectId"
WHERE ar."assignmentId" = a."id";

UPDATE "VisitLog" AS vl
SET "projectId" = s."projectId"
FROM "Site" AS s
WHERE vl."siteId" = s."id";

ALTER TABLE "AttendanceRecord" ALTER COLUMN "projectId" SET NOT NULL, ALTER COLUMN "siteId" SET NOT NULL;
ALTER TABLE "VisitLog" ALTER COLUMN "projectId" SET NOT NULL;

CREATE INDEX "AttendanceRecord_organizationId_projectId_attendanceDate_idx" ON "AttendanceRecord"("organizationId", "projectId", "attendanceDate");
CREATE INDEX "VisitLog_organizationId_projectId_visitedAt_idx" ON "VisitLog"("organizationId", "projectId", "visitedAt");

ALTER TABLE "Employee" ADD CONSTRAINT "Employee_currentProjectId_fkey" FOREIGN KEY ("currentProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkerProject" ADD CONSTRAINT "WorkerProject_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkerProject" ADD CONSTRAINT "WorkerProject_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkerProject" ADD CONSTRAINT "WorkerProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisitLog" ADD CONSTRAINT "VisitLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve existing configured Telegram group identity where a report group is already linked to a site.
UPDATE "Project" AS p
SET "telegramChatId" = trg."chatId"
FROM "TelegramReportGroup" AS trg
JOIN "Site" AS s ON s."id" = trg."siteId"
WHERE p."id" = s."projectId" AND p."telegramChatId" IS NULL;

-- Existing dated assignments establish known project connections without choosing a current project.
INSERT INTO "WorkerProject" ("id", "organizationId", "employeeId", "projectId", "connectedAt")
SELECT 'wp_' || md5(a."employeeId" || ':' || s."projectId"), a."organizationId", a."employeeId", s."projectId", CURRENT_TIMESTAMP
FROM "Assignment" AS a
JOIN "Site" AS s ON s."id" = a."siteId"
GROUP BY a."organizationId", a."employeeId", s."projectId"
ON CONFLICT ("employeeId", "projectId") DO NOTHING;
