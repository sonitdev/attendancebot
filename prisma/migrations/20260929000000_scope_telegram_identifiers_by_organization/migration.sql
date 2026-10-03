-- Telegram IDs identify external Telegram actors and chats. They are not tenant
-- identities, so their database uniqueness must be scoped to an organization.
DROP INDEX IF EXISTS "PendingTelegramProjectSelection_telegramUserId_key";
DROP INDEX IF EXISTS "TelegramAccount_telegramUserId_key";
DROP INDEX IF EXISTS "TelegramReportGroup_chatId_key";
DROP INDEX IF EXISTS "Project_telegramChatId_key";
DROP INDEX IF EXISTS "TelegramConversationState_telegramUserId_key";

CREATE UNIQUE INDEX "PendingTelegramProjectSelection_organizationId_telegramUserId_key"
  ON "PendingTelegramProjectSelection"("organizationId", "telegramUserId");
CREATE UNIQUE INDEX "TelegramAccount_organizationId_telegramUserId_key"
  ON "TelegramAccount"("organizationId", "telegramUserId");
CREATE UNIQUE INDEX "TelegramReportGroup_organizationId_chatId_key"
  ON "TelegramReportGroup"("organizationId", "chatId");
CREATE UNIQUE INDEX "Project_organizationId_telegramChatId_key"
  ON "Project"("organizationId", "telegramChatId");
CREATE UNIQUE INDEX "TelegramConversationState_organizationId_telegramUserId_key"
  ON "TelegramConversationState"("organizationId", "telegramUserId");
