import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { TelegramBotService } from '../src/telegram/telegram-bot.service.js';
import type { AttendanceService } from '../src/attendance/attendance.service.js';
import type { TelegramNotifierService } from '../src/jobs/telegram-notifier.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

describe('TelegramBotService', () => {
  let botService: TelegramBotService;
  let mockPrisma: any;
  let mockAttendanceService: any;
  let mockNotifier: any;
  let mockConfig: any;

  beforeEach(() => {
    mockPrisma = {
      telegramAccount: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      employee: {
        findMany: vi.fn(),
        create: vi.fn(),
        count: vi.fn(),
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      organization: {
        findFirst: vi.fn(),
      },
      $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
    };

    mockAttendanceService = {
      getWorkerToday: vi.fn(),
      checkIn: vi.fn(),
      checkOut: vi.fn(),
    };

    mockNotifier = {
      sendMessage: vi.fn().mockResolvedValue({ success: true, messageId: 999 }),
    };

    mockConfig = {
      get: vi.fn((key) => {
        if (key === 'TELEGRAM_MINI_APP_URL') return 'https://test-mini-app.local';
        return null;
      }),
    };

    botService = new TelegramBotService(
      mockPrisma as unknown as PrismaService,
      mockAttendanceService as unknown as AttendanceService,
      mockNotifier as unknown as TelegramNotifierService,
      mockConfig as unknown as ConfigService,
    );
  });

  describe('Unlinked Telegram users', () => {
    it('prompts unlinked user to share their phone number to register', async () => {
      mockPrisma.telegramAccount.findUnique.mockResolvedValue(null);

      const update = {
        message: {
          message_id: 1,
          from: { id: 987654321, first_name: 'Unknown', username: 'guest_user' },
          chat: { id: 987654321 },
          text: '/start',
          date: 1726671234,
        },
      };

      await botService.handleUpdate(update);

      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        '987654321',
        expect.stringContaining('Worker Registration & Access Authorization'),
        'Markdown',
        expect.objectContaining({
          keyboard: expect.arrayContaining([
            expect.arrayContaining([
              expect.objectContaining({
                text: '📱 Share Phone Number to Register',
                request_contact: true,
              }),
            ]),
          ]),
        }),
      );
    });

    it('successfully links existing employee when phone number matches', async () => {
      mockPrisma.telegramAccount.findUnique.mockResolvedValue(null);
      mockPrisma.employee.findMany = vi.fn().mockResolvedValue([
        {
          id: 'emp-sokha',
          employeeCode: 'EMP-001',
          fullName: 'Sokha Chan',
          phone: '+85512345678',
          organizationId: 'org-acme-1',
          telegramAccount: null,
          organization: { name: 'Acme Site Construction Ltd.' },
        },
      ]);
      mockPrisma.telegramAccount.create = vi.fn().mockResolvedValue({ id: 'acc-new' });
      mockPrisma.auditLog.create = vi.fn().mockResolvedValue({ id: 'aud-1' });

      const update = {
        message: {
          message_id: 2,
          from: { id: 987654321, first_name: 'Sokha', username: 'sokha_c' },
          chat: { id: 987654321 },
          date: 1726671234,
          contact: {
            phone_number: '+85512345678',
            user_id: 987654321,
            first_name: 'Sokha',
          },
        },
      };

      await botService.handleUpdate(update);

      expect(mockPrisma.telegramAccount.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          employeeId: 'emp-sokha',
          telegramUserId: '987654321',
        }),
      });

      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        '987654321',
        expect.stringContaining('Phone Number Verified & Authorized!'),
        'Markdown',
        expect.anything(),
      );
    });
  });

  describe('Linked worker commands', () => {
    const mockAccount = {
      id: 'acc-1',
      telegramUserId: '123456789',
      organizationId: 'org-acme-1',
      employeeId: 'emp-sokha',
      status: 'ACTIVE',
      employee: {
        id: 'emp-sokha',
        fullName: 'Sokha Chan',
        employeeCode: 'EMP-001',
      },
      organization: {
        id: 'org-acme-1',
        name: 'Acme Site Construction Ltd.',
      },
    };

    beforeEach(() => {
      mockPrisma.telegramAccount.findUnique.mockResolvedValue(mockAccount);
    });

    it('sends welcome message and Mini App attendance button on /start', async () => {
      const update = {
        message: {
          message_id: 2,
          from: { id: 123456789, first_name: 'Sokha' },
          chat: { id: 123456789 },
          text: '/start',
          date: 1726671234,
        },
      };

      await botService.handleUpdate(update);

      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        '123456789',
        expect.stringContaining('Welcome, *Sokha Chan*!'),
        'Markdown',
        expect.objectContaining({
          keyboard: expect.arrayContaining([
            expect.arrayContaining([
              expect.objectContaining({
                text: '📷 Open Attendance',
                web_app: expect.objectContaining({ url: 'https://test-mini-app.local' }),
              }),
            ]),
          ]),
        }),
      );
    });

    it('routes /checkin to the Mini App attendance button', async () => {
      const update = {
        message: {
          message_id: 3,
          from: { id: 123456789, first_name: 'Sokha' },
          chat: { id: 123456789 },
          text: '/checkin',
          date: 1726671234,
        },
      };

      await botService.handleUpdate(update);

      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        '123456789',
        expect.stringContaining('Open Attendance to Check In'),
        'Markdown',
        expect.objectContaining({
          keyboard: expect.arrayContaining([
            expect.arrayContaining([
              expect.objectContaining({
                text: '📷 Open Attendance',
                web_app: expect.objectContaining({ url: 'https://test-mini-app.local' }),
              }),
            ]),
          ]),
        }),
      );
    });
  });

  describe('Native Telegram GPS Location Processing', () => {
    const mockAccount = {
      id: 'acc-1',
      telegramUserId: '123456789',
      organizationId: 'org-acme-1',
      employeeId: 'emp-sokha',
      status: 'ACTIVE',
      employee: {
        id: 'emp-sokha',
        fullName: 'Sokha Chan',
        employeeCode: 'EMP-001',
      },
      organization: {
        id: 'org-acme-1',
        name: 'Acme Site Construction Ltd.',
      },
    };

    beforeEach(() => {
      mockPrisma.telegramAccount.findUnique.mockResolvedValue(mockAccount);
    });

    it('records check-in when worker shares location and shift is not started', async () => {
      mockAttendanceService.getWorkerToday.mockResolvedValue({
        date: '2026-09-18',
        siteTimezone: 'Asia/Phnom_Penh',
        site: {
          name: 'Main Construction Site A',
          allowedRadiusMeters: 200,
        },
        schedule: {
          startTime: '08:00',
          endTime: '17:00',
        },
        attendance: null, // Not yet checked in
      });

      mockAttendanceService.checkIn.mockResolvedValue({
        attendanceId: 'rec-1',
        action: 'CHECK_IN',
        status: 'ON_TIME',
        verificationResult: 'VERIFIED',
        timestamp: '2026-09-18T01:02:00.000Z',
        distanceMeters: 25.4,
        workDurationMinutes: null,
        message: 'CHECK_IN_SUCCESS',
      });

      const update = {
        message: {
          message_id: 101,
          from: { id: 123456789, first_name: 'Sokha' },
          chat: { id: 123456789 },
          date: 1726671234,
          location: {
            latitude: 11.5564,
            longitude: 104.9282,
            horizontal_accuracy: 10,
          },
        },
      };

      await botService.handleUpdate(update);

      // Verifies AttendanceService.checkIn was invoked with native coordinates
      expect(mockAttendanceService.checkIn).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: 'emp-sokha',
          organizationId: 'org-acme-1',
        }),
        expect.objectContaining({
          latitude: 11.5564,
          longitude: 104.9282,
          accuracyMeters: 10,
        }),
        'tg-msg-101',
      );

      // Verifies Telegram confirmation message was sent
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        '123456789',
        expect.stringContaining('Check-In Verified & Recorded!'),
        'Markdown',
        expect.anything(),
      );
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        '123456789',
        expect.stringContaining('25.4m'),
        'Markdown',
        expect.anything(),
      );
    });

    it('records check-out when worker shares location and is already checked in', async () => {
      mockAttendanceService.getWorkerToday.mockResolvedValue({
        date: '2026-09-18',
        siteTimezone: 'Asia/Phnom_Penh',
        site: {
          name: 'Main Construction Site A',
          allowedRadiusMeters: 200,
        },
        schedule: {
          startTime: '08:00',
          endTime: '17:00',
        },
        attendance: {
          id: 'rec-1',
          status: 'ON_TIME',
          checkInAt: '2026-09-18T01:00:00.000Z',
          checkOutAt: null, // Open shift
        },
      });

      mockAttendanceService.checkOut.mockResolvedValue({
        attendanceId: 'rec-1',
        action: 'CHECK_OUT',
        status: 'COMPLETED',
        verificationResult: 'VERIFIED',
        timestamp: '2026-09-18T10:00:00.000Z',
        distanceMeters: 30.1,
        workDurationMinutes: 540,
        message: 'CHECK_OUT_SUCCESS',
      });

      const update = {
        message: {
          message_id: 102,
          from: { id: 123456789, first_name: 'Sokha' },
          chat: { id: 123456789 },
          date: 1726671234,
          location: {
            latitude: 11.5564,
            longitude: 104.9282,
            horizontal_accuracy: 8,
          },
        },
      };

      await botService.handleUpdate(update);

      // Verifies AttendanceService.checkOut was invoked
      expect(mockAttendanceService.checkOut).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: 'emp-sokha',
          organizationId: 'org-acme-1',
        }),
        expect.objectContaining({
          latitude: 11.5564,
          longitude: 104.9282,
        }),
        'tg-msg-102',
      );

      // Verifies Telegram checkout confirmation
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        '123456789',
        expect.stringContaining('Check-Out Successfully Recorded!'),
        'Markdown',
        expect.anything(),
      );
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        '123456789',
        expect.stringContaining('9h 0m'),
        'Markdown',
        expect.anything(),
      );
    });

    it('informs worker if shift is already completed for today', async () => {
      mockAttendanceService.getWorkerToday.mockResolvedValue({
        date: '2026-09-18',
        siteTimezone: 'Asia/Phnom_Penh',
        site: {
          name: 'Main Construction Site A',
        },
        attendance: {
          id: 'rec-1',
          status: 'COMPLETED',
          checkInAt: '2026-09-18T01:00:00.000Z',
          checkOutAt: '2026-09-18T10:00:00.000Z',
          workDurationMinutes: 540,
        },
      });

      const update = {
        message: {
          message_id: 103,
          from: { id: 123456789, first_name: 'Sokha' },
          chat: { id: 123456789 },
          date: 1726671234,
          location: {
            latitude: 11.5564,
            longitude: 104.9282,
          },
        },
      };

      await botService.handleUpdate(update);

      expect(mockAttendanceService.checkIn).not.toHaveBeenCalled();
      expect(mockAttendanceService.checkOut).not.toHaveBeenCalled();
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        '123456789',
        expect.stringContaining('Shift Already Completed Today'),
        'Markdown',
        expect.anything(),
      );
    });
  });
});
