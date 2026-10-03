ALTER TABLE "TelegramReportGroup" ADD COLUMN "siteId" TEXT, ADD COLUMN "workerGroupId" TEXT;
CREATE INDEX "TelegramReportGroup_siteId_idx" ON "TelegramReportGroup"("siteId");
CREATE INDEX "TelegramReportGroup_workerGroupId_idx" ON "TelegramReportGroup"("workerGroupId");
ALTER TABLE "TelegramReportGroup" ADD CONSTRAINT "TelegramReportGroup_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TelegramReportGroup" ADD CONSTRAINT "TelegramReportGroup_workerGroupId_fkey" FOREIGN KEY ("workerGroupId") REFERENCES "WorkerGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
