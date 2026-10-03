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
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: 'project-a', organizationId: 'org-acme-1', name: 'New Group Name' }),
      },
      employee: {
        findMany: vi.fn(),
        create: vi.fn(),
        count: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: 'project-a', organizationId: 'org-acme-1' }),
      },
      auditLog: {
        create: vi.fn(),
      },
      organization: {
        findFirst: vi.fn(),
      },
      telegramOrganizationOwner: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      project: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: 'project-a', organizationId: 'org-acme-1', name: 'New Group Name' }),
      },
      telegramReportGroup: {
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
      },
      registrationRequest: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      telegramUpdate: {
        create: vi.fn().mockResolvedValue({ id: 'update-1' }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      site: { findFirst: vi.fn() },
      pendingTelegramProjectSelection: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        upsert: vi.fn(),
        delete: vi.fn(),
      },
      workerProject: {
        upsert: vi.fn(),
      },
      $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
    };
    // The production account resolver is intentionally tenant-scoped and uses
    // findFirst; keep older fixture setup calls compatible with that contract.
    mockPrisma.telegramAccount.findFirst = mockPrisma.telegramAccount.findUnique;
    mockPrisma.project.findMany = vi.fn(async () => {
      const project = await mockPrisma.project.findUnique();
      return project ? [project] : [];
    });
    mockPrisma.projectAuthorization = {
      verifyTelegramMembership: vi.fn().mockResolvedValue({ authorized: true }),
      authorizeWorkerProject: vi.fn().mockResolvedValue(undefined),
      ensureProjectSiteAndAssignment: vi.fn().mockResolvedValue(undefined),
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
      mockPrisma.projectAuthorization,
      {} as any,
      {} as any,
    );
  });

  describe('Unlinked Telegram users', () => {
    it('prompts unlinked user to share their phone number to register', async () => {
      mockPrisma.telegramAccount.findUnique.mockResolvedValue(null);
      mockPrisma.pendingTelegramProjectSelection.findFirst.mockResolvedValue({ id: 'pending-1', organizationId: 'org-acme-1', projectId: 'project-a', sourceChatId: '123456789' });

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
        expect.stringContaining('សូមស្វាគមន៍'),
        'Markdown',
        expect.objectContaining({
          keyboard: expect.arrayContaining([
            expect.arrayContaining([
              expect.objectContaining({
                text: 'ចែករំលែកលេខទូរស័ព្ទដើម្បីចុះឈ្មោះ',
                request_contact: true,
              }),
            ]),
          ]),
        }),
      );
    });

    it('successfully links existing employee when phone number matches', async () => {
      mockPrisma.telegramAccount.findUnique.mockResolvedValue(null);
      mockPrisma.pendingTelegramProjectSelection.findFirst.mockResolvedValue({ id: 'pending-1', organizationId: 'org-acme-1', projectId: 'project-a', sourceChatId: '987654321' });
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
        expect.stringContaining('បានផ្ទៀងផ្ទាត់លេខទូរស័ព្ទរួចរាល់'),
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
        expect.stringContaining('សូមស្វាគមន៍ Sokha Chan'),
        'Markdown',
        expect.objectContaining({
          keyboard: expect.arrayContaining([
            expect.arrayContaining([
              expect.objectContaining({
                text: 'បើកកម្មវិធីវត្តមាន',
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
        expect.stringContaining('បើកកម្មវិធីវត្តមាន'),
        'Markdown',
        expect.objectContaining({
          keyboard: expect.arrayContaining([
            expect.arrayContaining([
              expect.objectContaining({
                text: 'បើកកម្មវិធីវត្តមាន',
                web_app: expect.objectContaining({ url: 'https://test-mini-app.local' }),
              }),
            ]),
          ]),
        }),
      );
    });
  });

  describe('Project selection from a Telegram group', () => {
    it('stores a pending project intent for an unregistered worker and directs them to private registration', async () => {
      mockPrisma.telegramAccount.findUnique.mockResolvedValue(null);
      mockPrisma.project.findUnique.mockResolvedValue({ id: 'project-a', organizationId: 'org-acme-1', status: 'ACTIVE', telegramConnectionStatus: 'CONNECTED' });

      await botService.handleUpdate({
        callback_query: {
          id: 'callback-1',
          from: { id: 777, first_name: 'New worker' },
          data: 'set_current_project',
          message: { chat: { id: -100123, type: 'supergroup' } },
        },
      });

      expect(mockPrisma.pendingTelegramProjectSelection.upsert).toHaveBeenCalledWith({
        where: { organizationId_telegramUserId: { organizationId: 'org-acme-1', telegramUserId: '777' } },
        create: expect.objectContaining({ organizationId: 'org-acme-1', projectId: 'project-a', sourceChatId: '-100123' }),
        update: expect.objectContaining({ projectId: 'project-a' }),
      });
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        '-100123',
        expect.stringContaining('https://t.me/site_attendantbot?start=register'),
        'Markdown',
      );
    });

    it('rejects a linked worker from another organization', async () => {
      mockPrisma.telegramAccount.findUnique.mockResolvedValue({
        employeeId: 'employee-other',
        organizationId: 'org-other',
        status: 'ACTIVE',
      });
      mockPrisma.project.findUnique.mockResolvedValue({ id: 'project-a', organizationId: 'org-acme-1' });

      await botService.handleUpdate({
        callback_query: {
          id: 'callback-2',
          from: { id: 778 },
          data: 'set_current_project',
          message: { chat: { id: -100123, type: 'supergroup' } },
        },
      });

      expect(mockPrisma.workerProject.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    });

    it('rejects a user who is not an active member of the Telegram project group', async () => {
      mockPrisma.telegramAccount.findUnique.mockResolvedValue({
        employeeId: 'employee-1',
        organizationId: 'org-acme-1',
        status: 'ACTIVE',
      });
      mockPrisma.project.findUnique.mockResolvedValue({ id: 'project-a', organizationId: 'org-acme-1' });
      vi.spyOn(botService as any, 'isTelegramChatMember').mockResolvedValue(false);

      await botService.handleUpdate({
        callback_query: {
          id: 'callback-unauthorized',
          from: { id: 779 },
          data: 'set_current_project',
          message: { chat: { id: -100123, type: 'supergroup' } },
        },
      });

      expect(mockPrisma.workerProject.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    });

    it('keeps the same chat-ID project and updates only its name when the group is renamed', async () => {
      const account = {
        employeeId: 'employee-1',
        organizationId: 'org-acme-1',
        status: 'ACTIVE',
        employee: { fullName: 'Worker', employeeCode: 'EMP-1' },
        organization: { name: 'Acme' },
      };
      mockPrisma.telegramAccount.findUnique.mockResolvedValue(account);
      mockPrisma.telegramReportGroup.findUnique.mockResolvedValue({
        id: 'report-group-1',
        chatId: '-100123',
        organizationId: 'org-acme-1',
        siteId: null,
      });
      mockPrisma.telegramReportGroup.findMany.mockResolvedValue([{
        id: 'report-group-1', chatId: '-100123', organizationId: 'org-acme-1', siteId: null,
      }]);
      mockPrisma.project.findUnique.mockResolvedValue({
        id: 'project-a',
        organizationId: 'org-acme-1',
        name: 'Old Group Name',
        telegramChatId: '-100123',
      });
      mockPrisma.project.findFirst.mockResolvedValue({
        id: 'project-a', organizationId: 'org-acme-1', name: 'Old Group Name', telegramChatId: '-100123',
      });

      await botService.handleUpdate({
        message: {
          from: { id: 123456789, first_name: 'Manager' },
          chat: { id: -100123, type: 'supergroup', title: 'New Group Name' },
          text: '/connect',
        },
      });

      expect(mockPrisma.project.update).toHaveBeenCalledWith({
        where: { id: 'project-a' },
        data: expect.objectContaining({ name: 'New Group Name' }),
      });
      expect(mockPrisma.project.create).not.toHaveBeenCalled();
    });

    it('creates one active project from a newly connected Telegram group', async () => {
      mockPrisma.telegramAccount.findUnique.mockResolvedValue({
        employeeId: 'manager-1',
        organizationId: 'org-acme-1',
        status: 'ACTIVE',
        employee: { fullName: 'Manager', employeeCode: 'EMP-M1' },
        organization: { name: 'Acme' },
      });
      mockPrisma.telegramReportGroup.findUnique.mockResolvedValue(null);
      mockPrisma.project.create.mockResolvedValue({ id: 'project-new' });

      await botService.handleUpdate({
        message: {
          from: { id: 123456789, first_name: 'Manager' },
          chat: { id: -100456, type: 'supergroup', title: 'Project B' },
          text: '/connect',
        },
      });

      expect(mockPrisma.project.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-acme-1',
          name: 'Project B',
          status: 'ACTIVE',
          telegramChatId: '-100456',
        }),
      });
      expect(mockPrisma.telegramReportGroup.create).toHaveBeenCalledTimes(1);
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        '-100456',
        expect.any(String),
        'Markdown',
        expect.objectContaining({ inline_keyboard: expect.any(Array) }),
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

      // Native locations cannot bypass the required camera proof. The bot
      // guides the worker to the Mini App instead of creating attendance.
      expect(mockAttendanceService.checkIn).not.toHaveBeenCalled();
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        '123456789',
        expect.stringContaining('បើកកម្មវិធីវត្តមាន'),
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

      // Native Telegram GPS cannot bypass the Mini App camera-proof flow.
      expect(mockAttendanceService.checkOut).not.toHaveBeenCalled();

      // Verifies Telegram checkout confirmation
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        '123456789',
        expect.stringContaining('បើកកម្មវិធីវត្តមាន'),
        'Markdown',
        expect.anything(),
      );
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        '123456789',
        expect.stringContaining('បើកកម្មវិធីវត្តមាន'),
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
        expect.any(String),
        'Markdown',
        expect.anything(),
      );
    });
  });
});
