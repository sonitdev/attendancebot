import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramOutboxService } from '../src/jobs/telegram-outbox.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import type { TelegramNotifierService } from '../src/jobs/telegram-notifier.service.js';

describe('TelegramOutboxService', () => {
  let prisma: any;
  let notifier: any;
  let service: TelegramOutboxService;

  beforeEach(() => {
    prisma = {
      telegramDelivery: {
        updateMany: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
      },
    };
    notifier = {
      sendMessage: vi.fn(),
      sendPhoto: vi.fn(),
    };
    service = new TelegramOutboxService(
      prisma as unknown as PrismaService,
      notifier as unknown as TelegramNotifierService,
    );
  });

  it('claims and sends a photo delivery exactly once', async () => {
    prisma.telegramDelivery.updateMany.mockResolvedValue({ count: 1 });
    prisma.telegramDelivery.findFirst.mockResolvedValue({
      id: 'delivery-1',
      kind: 'PHOTO',
      chatId: '-1001',
      text: 'caption',
      storagePath: 'org/worker/proof.jpg',
      attempts: 1,
    });
    notifier.sendPhoto.mockResolvedValue({ success: true, messageId: 88 });

    await expect(service.processDeliveryById('delivery-1', 'org')).resolves.toBe(true);
    expect(notifier.sendPhoto).toHaveBeenCalledWith('-1001', 'org/worker/proof.jpg', 'caption');
    expect(prisma.telegramDelivery.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'delivery-1', organizationId: 'org' }),
      data: expect.objectContaining({ status: 'SENT', telegramMessageId: '88' }),
    });
  });

  it('schedules a failed delivery for retry without changing attendance', async () => {
    prisma.telegramDelivery.updateMany.mockResolvedValue({ count: 1 });
    prisma.telegramDelivery.findFirst.mockResolvedValue({
      id: 'delivery-2',
      kind: 'TEXT',
      chatId: '-1002',
      text: 'checkout',
      storagePath: null,
      attempts: 2,
    });
    notifier.sendMessage.mockResolvedValue({ success: false, retryable: true, error: 'TELEGRAM_REJECTED_429' });

    await expect(service.processDeliveryById('delivery-2', 'org')).resolves.toBe(false);
    expect(prisma.telegramDelivery.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'delivery-2', organizationId: 'org' }),
      data: expect.objectContaining({ status: 'FAILED', lastError: 'TELEGRAM_REJECTED_429' }),
    });
  });

  it('does not send when another worker already claimed the delivery', async () => {
    prisma.telegramDelivery.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.processDeliveryById('delivery-3', 'org')).resolves.toBe(false);
    expect(notifier.sendMessage).not.toHaveBeenCalled();
    expect(notifier.sendPhoto).not.toHaveBeenCalled();
  });
});
