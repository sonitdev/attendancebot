CREATE TABLE "VisitLog" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "latitude" DECIMAL(9,6) NOT NULL,
  "longitude" DECIMAL(9,6) NOT NULL,
  "accuracyMeters" DECIMAL(8,2) NOT NULL,
  "distanceMeters" DECIMAL(10,2) NOT NULL,
  "verification" "VerificationStatus" NOT NULL,
  "proofPhotoPath" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  CONSTRAINT "VisitLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VisitLog_organizationId_employeeId_idempotencyKey_key" ON "VisitLog"("organizationId", "employeeId", "idempotencyKey");
CREATE INDEX "VisitLog_organizationId_employeeId_visitedAt_idx" ON "VisitLog"("organizationId", "employeeId", "visitedAt");
CREATE INDEX "VisitLog_organizationId_siteId_visitedAt_idx" ON "VisitLog"("organizationId", "siteId", "visitedAt");
ALTER TABLE "VisitLog" ADD CONSTRAINT "VisitLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisitLog" ADD CONSTRAINT "VisitLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisitLog" ADD CONSTRAINT "VisitLog_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisitLog" ADD CONSTRAINT "VisitLog_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
