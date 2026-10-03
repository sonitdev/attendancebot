-- Durable sales follow-up intent shares the attendance transaction and recovery worker.
-- Forward-only: existing TEXT/PHOTO deliveries remain unchanged.
ALTER TYPE "TelegramDeliveryKind" ADD VALUE IF NOT EXISTS 'SALES_REPORT';
