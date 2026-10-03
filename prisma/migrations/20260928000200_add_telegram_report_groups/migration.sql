CREATE TABLE "TelegramReportGroup" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "title" TEXT,
  "connectedByEmployeeId" TEXT NOT NULL,
  "status" "LifecycleStatus" NOT NULL DEFAULT 'INACTIVE',
  "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TelegramReportGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramReportGroup_chatId_key" ON "TelegramReportGroup"("chatId");
CREATE INDEX "TelegramReportGroup_organizationId_status_idx" ON "TelegramReportGroup"("organizationId", "status");

ALTER TABLE "TelegramReportGroup"
  ADD CONSTRAINT "TelegramReportGroup_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
