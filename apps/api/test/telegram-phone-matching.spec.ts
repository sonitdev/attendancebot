import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminService } from '../src/admin/admin.service.js';
import { maskPhone, normalizePhone } from '../src/common/phone.util.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { TelegramBotService } from '../src/telegram/telegram-bot.service.js';

describe('Phase 2: Phone Normalization & Verified Telegram Contact Matching', () => {
  let adminService: AdminService;
  let telegramBotService: TelegramBotService;
  let mockPrisma: any;
  let mockNotifier: any;

  const orgId1 = 'org-acme';

  beforeEach(() => {
    mockPrisma = {
      employee: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      telegramAccount: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      organization: {
        findFirst: vi.fn(),
      },
      telegramOrganizationOwner: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      registrationRequest: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      pendingTelegramProjectSelection: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        delete: vi.fn(),
      },
      workerProject: {
        upsert: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
    };
    mockPrisma.telegramAccount.findFirst = mockPrisma.telegramAccount.findUnique;
    const projectAuthorization = {
      authorizeWorkerProject: vi.fn().mockResolvedValue(undefined),
      ensureProjectSiteAndAssignment: vi.fn().mockResolvedValue(undefined),
    };

    mockNotifier = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };

    adminService = new AdminService(mockPrisma as unknown as PrismaService);

    telegramBotService = new TelegramBotService(
      mockPrisma as unknown as PrismaService,
      {} as any,
      mockNotifier as any,
      { get: vi.fn() } as any,
      projectAuthorization as any,
      {} as any,
      {} as any,
    );

    vi.spyOn(telegramBotService as any, 'sendMainMenu').mockResolvedValue(undefined);
  });

  describe('Phone Utility (E.164 Normalization & Masking)', () => {
    it('normalizes various phone number formats into E.164 standard', () => {
      expect(normalizePhone('+855 12 345 678')).toBe('+85512345678');
      expect(normalizePhone('  +855-12-345-678 ')).toBe('+85512345678');
      expect(normalizePhone('012345678')).toBe('+85512345678');
      expect(normalizePhone('+1 (555) 000-1234')).toBe('+15550001234');
      expect(normalizePhone(null)).toBeNull();
      expect(normalizePhone('')).toBeNull();
      expect(normalizePhone('123')).toBeNull();
    });

    it('masks phone numbers for privacy in admin responses', () => {
      expect(maskPhone('+85512345678')).toBe('+855****5678');
      expect(maskPhone('+15550001234')).toBe('+155****1234');
      expect(maskPhone(null)).toBeNull();
      expect(maskPhone(undefined)).toBeNull();
    });
  });

  describe('Tenant-Scoped Phone Uniqueness in AdminService', () => {
    it('creates employee storing normalized phone and enforces tenant uniqueness', async () => {
      mockPrisma.employee.findUnique.mockResolvedValue(null);
      mockPrisma.employee.create.mockResolvedValue({
        id: 'emp-201',
        organizationId: orgId1,
        employeeCode: 'EMP-201',
        fullName: 'Channarong Hok',
        phone: '+855 12 345 678',
        normalizedPhone: '+85512345678',
      });

      const emp = await adminService.createEmployee(orgId1, {
        employeeCode: 'EMP-201',
        fullName: 'Channarong Hok',
        phone: '+855 12 345 678',
      });

      expect(mockPrisma.employee.create).toHaveBeenCalledWith({
        data: {
          organizationId: orgId1,
          employeeCode: 'EMP-201',
          fullName: 'Channarong Hok',
          phone: '+855 12 345 678',
          normalizedPhone: '+85512345678',
          jobTitle: undefined,
          status: 'ACTIVE',
        },
      });
      expect(emp.id).toBe('emp-201');
    });

    it('rejects employee creation with duplicate phone in same tenant', async () => {
      // First call for employee code check returns null, second call for phone check returns existing
      mockPrisma.employee.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'emp-existing', normalizedPhone: '+85512345678' });

      await expect(
        adminService.createEmployee(orgId1, {
          employeeCode: 'EMP-202',
          fullName: 'Duplicate Phone Worker',
          phone: '+855 12 345 678',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('masks phone numbers in Admin listEmployees response', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([
        {
          id: 'emp-201',
          employeeCode: 'EMP-201',
          fullName: 'Channarong Hok',
          jobTitle: 'Technician',
          phone: '+85512345678',
          avatarUrl: null,
          status: 'ACTIVE',
          telegramAccount: null,
        },
      ]);

      const list = await adminService.listEmployees(orgId1);
      expect(list[0].phone).toBe('+855****5678');
    });
  });

  describe('Verified Telegram Contact Matching', () => {
    it('links Telegram account when shared contact matches exactly one pre-created active employee', async () => {
      mockPrisma.telegramAccount.findUnique.mockResolvedValue(null);
      mockPrisma.pendingTelegramProjectSelection.findFirst.mockResolvedValue({ id: 'pending-1', organizationId: orgId1, projectId: 'project-1', sourceChatId: 'chat-123' });

      mockPrisma.employee.findMany.mockResolvedValue([
        {
          id: 'emp-201',
          organizationId: orgId1,
          employeeCode: 'EMP-201',
          fullName: 'Channarong Hok',
          phone: '+855 12 345 678',
          normalizedPhone: '+85512345678',
          telegramAccount: null,
          organization: { id: orgId1, name: 'Acme Construction' },
        },
      ]);

      await telegramBotService.handleContactRegistration('chat-123', { id: 999888 }, {
        phone_number: '+85512345678',
        user_id: 999888,
      });

      expect(mockPrisma.telegramAccount.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: orgId1,
          employeeId: 'emp-201',
          telegramUserId: '999888',
        }),
      });

      expect((telegramBotService as any).sendMainMenu).toHaveBeenCalledWith(
        'chat-123',
        expect.stringContaining('បានផ្ទៀងផ្ទាត់លេខទូរស័ព្ទរួចរាល់'),
      );
    });

    it('shows "contact your manager" notice and does NOT auto-create employee when zero match is found', async () => {
      mockPrisma.telegramAccount.findUnique.mockResolvedValue(null);
      mockPrisma.employee.findMany.mockResolvedValue([]);

      await telegramBotService.handleContactRegistration('chat-123', { id: 777666 }, {
        phone_number: '+85599999999',
        user_id: 777666,
      });

      // Must NOT create employee or telegramAccount
      expect(mockPrisma.employee.create).not.toHaveBeenCalled();
      expect(mockPrisma.telegramAccount.create).not.toHaveBeenCalled();
      expect(mockPrisma.registrationRequest.create).not.toHaveBeenCalled();

      // With no group-selected project there is no trustworthy organization
      // scope, so the bot must explain how to select one instead of claiming
      // that a request was submitted.
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        'chat-123',
        expect.stringContaining('/connect'),
        'Markdown',
        expect.anything(),
      );
    });

    it('shows "contact your manager" notice and does NOT link when duplicate matches are found', async () => {
      mockPrisma.telegramAccount.findUnique.mockResolvedValue(null);
      mockPrisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1', organizationId: orgId1, employeeCode: 'EMP-1', normalizedPhone: '+85512345678', organization: { name: 'Org 1' } },
        { id: 'emp-2', organizationId: 'org-2', employeeCode: 'EMP-2', normalizedPhone: '+85512345678', organization: { name: 'Org 2' } },
      ]);

      await telegramBotService.handleContactRegistration('chat-123', { id: 555444 }, {
        phone_number: '+85512345678',
        user_id: 555444,
      });

      // Must NOT create or link
      expect(mockPrisma.telegramAccount.create).not.toHaveBeenCalled();
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        'chat-123',
        expect.any(String),
        'Markdown',
        expect.anything(),
      );
    });
  });
});
