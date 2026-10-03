-- Keeps a worker's group/project intent while they complete private-bot
-- registration. This is additive and does not alter attendance history.
CREATE TABLE "PendingTelegramProjectSelection" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "telegramUserId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sourceChatId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PendingTelegramProjectSelection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PendingTelegramProjectSelection_telegramUserId_key"
  ON "PendingTelegramProjectSelection"("telegramUserId");
CREATE INDEX "PendingTelegramProjectSelection_organizationId_projectId_idx"
  ON "PendingTelegramProjectSelection"("organizationId", "projectId");

ALTER TABLE "PendingTelegramProjectSelection"
  ADD CONSTRAINT "PendingTelegramProjectSelection_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PendingTelegramProjectSelection"
  ADD CONSTRAINT "PendingTelegramProjectSelection_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
