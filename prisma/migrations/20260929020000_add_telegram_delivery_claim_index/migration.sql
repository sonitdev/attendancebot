-- Keeps tenant-scoped pending/retry claims ordered by creation time.
CREATE INDEX "TelegramDelivery_organizationId_status_nextAttemptAt_createdAt_idx"
ON "TelegramDelivery" ("organizationId", "status", "nextAttemptAt", "createdAt");
