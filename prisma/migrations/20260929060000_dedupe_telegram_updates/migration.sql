CREATE TABLE "TelegramUpdate" (
    "id" TEXT NOT NULL,
    "updateId" INTEGER NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TelegramUpdate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramUpdate_updateId_key" ON "TelegramUpdate"("updateId");
CREATE INDEX "TelegramUpdate_processedAt_idx" ON "TelegramUpdate"("processedAt");
