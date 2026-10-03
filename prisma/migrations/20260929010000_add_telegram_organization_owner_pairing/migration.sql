CREATE TABLE "TelegramOrganizationOwner" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "setupCode" TEXT NOT NULL,
  "setupCodeExpiresAt" TIMESTAMP(3) NOT NULL,
  "setupCodeUsedAt" TIMESTAMP(3),
  "telegramUserId" TEXT,
  "telegramUsername" TEXT,
  "pairedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TelegramOrganizationOwner_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TelegramReportGroup" ALTER COLUMN "connectedByEmployeeId" DROP NOT NULL;

CREATE UNIQUE INDEX "TelegramOrganizationOwner_organizationId_key" ON "TelegramOrganizationOwner"("organizationId");
CREATE UNIQUE INDEX "TelegramOrganizationOwner_setupCode_key" ON "TelegramOrganizationOwner"("setupCode");
CREATE UNIQUE INDEX "TelegramOrganizationOwner_telegramUserId_key" ON "TelegramOrganizationOwner"("telegramUserId");
CREATE INDEX "TelegramOrganizationOwner_setupCode_setupCodeExpiresAt_idx" ON "TelegramOrganizationOwner"("setupCode", "setupCodeExpiresAt");

ALTER TABLE "TelegramOrganizationOwner" ADD CONSTRAINT "TelegramOrganizationOwner_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TelegramOrganizationOwner" ADD CONSTRAINT "TelegramOrganizationOwner_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
