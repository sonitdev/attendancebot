CREATE TYPE "TelegramDeliveryKind" AS ENUM ('TEXT', 'PHOTO');
CREATE TYPE "TelegramDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

CREATE TABLE "TelegramDelivery" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "attendanceRecordId" TEXT NOT NULL,
  "kind" "TelegramDeliveryKind" NOT NULL,
  "chatId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "storagePath" TEXT,
  "status" "TelegramDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "telegramMessageId" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TelegramDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramDelivery_attendanceRecordId_kind_key"
  ON "TelegramDelivery"("attendanceRecordId", "kind");
CREATE INDEX "TelegramDelivery_status_nextAttemptAt_idx"
  ON "TelegramDelivery"("status", "nextAttemptAt");
CREATE INDEX "TelegramDelivery_organizationId_createdAt_idx"
  ON "TelegramDelivery"("organizationId", "createdAt");

ALTER TABLE "TelegramDelivery"
  ADD CONSTRAINT "TelegramDelivery_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TelegramDelivery"
  ADD CONSTRAINT "TelegramDelivery_attendanceRecordId_fkey"
  FOREIGN KEY ("attendanceRecordId") REFERENCES "AttendanceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
