import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistrationRequestsController } from '../src/registration-requests/registration-requests.controller.js';
import { RegistrationRequestsService } from '../src/registration-requests/registration-requests.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import type { TelegramNotifierService } from '../src/jobs/telegram-notifier.service.js';

describe('Registration Requests & Manager Approval Workflow', () => {
  let registrationRequestsService: RegistrationRequestsService;
  let registrationRequestsController: RegistrationRequestsController;
  let mockPrisma: any;
  let mockNotifier: any;

  const orgId1 = 'org-acme';
  const adminUser1 = { userId: 'user-admin-1', organizationId: orgId1, email: 'admin@acme.com', roles: ['OWNER', 'HR'] };

  beforeEach(() => {
    mockPrisma = {
      registrationRequest: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      employee: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      telegramAccount: {
        create: vi.fn(),
      },
      employeePositionHistory: {
        create: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
    };

    mockNotifier = {
      sendMessage: vi.fn().mockResolvedValue({ success: true }),
    };

    registrationRequestsService = new RegistrationRequestsService(
      mockPrisma as unknown as PrismaService,
      mockNotifier as unknown as TelegramNotifierService,
    );
    registrationRequestsController = new RegistrationRequestsController(registrationRequestsService);
  });

  describe('Listing Registration Requests', () => {
    it('returns formatted list of registration requests for organization', async () => {
      mockPrisma.registrationRequest.findMany.mockResolvedValue([
        {
          id: 'reg-1',
          organizationId: orgId1,
          telegramUserId: 'tg-100',
          phone: '+855977429389',
          normalizedPhone: '+855977429389',
          telegramUsername: 'john_worker',
          telegramFirstName: 'John',
          telegramLastName: 'Doe',
          telegramPhotoUrl: 'https://example.com/photo.jpg',
          status: 'PENDING',
          reviewNote: null,
          createdEmployeeId: null,
          requestedAt: new Date('2026-09-19T10:00:00Z'),
          reviewedAt: null,
        },
      ]);

      const res = await registrationRequestsController.listRequests(orgId1);

      expect(mockPrisma.registrationRequest.findMany).toHaveBeenCalledWith({
        where: { organizationId: orgId1 },
        orderBy: { requestedAt: 'desc' },
      });
      expect(res).toHaveLength(1);
      expect(res[0].telegramUserId).toBe('tg-100');
      expect(res[0].status).toBe('PENDING');
    });
  });

  describe('Manager Approval Workflow', () => {
    it('approving request transactionally creates Employee, TelegramAccount, AuditLog, updates request, and notifies worker', async () => {
      const requestId = 'reg-101';
      mockPrisma.registrationRequest.findFirst.mockResolvedValue({
        id: requestId,
        organizationId: orgId1,
        telegramUserId: 'tg-101',
        phone: '+855977429389',
        normalizedPhone: '+855977429389',
        telegramUsername: 'sok_worker',
        telegramFirstName: 'Sok',
        telegramLastName: 'Dara',
        telegramPhotoUrl: null,
        status: 'PENDING',
      });

      mockPrisma.employee.findUnique.mockResolvedValue(null);

      mockPrisma.employee.create.mockResolvedValue({
        id: 'emp-999',
        organizationId: orgId1,
        employeeCode: 'EMP-101',
        fullName: 'Sok Dara',
      });

      mockPrisma.registrationRequest.update.mockResolvedValue({
        id: requestId,
        status: 'APPROVED',
        reviewedAt: new Date(),
        reviewedByUserId: 'user-admin-1',
        reviewNote: 'Verified phone contact',
        createdEmployeeId: 'emp-999',
      });

      const res = await registrationRequestsController.resolveRequest(orgId1, adminUser1 as any, requestId, {
        approved: true,
        employeeCode: 'EMP-101',
        fullName: 'Sok Dara',
        positionId: 'pos-mason',
        reviewNote: 'Verified phone contact',
      });

      // 1. Transactionally creates Employee
      expect(mockPrisma.employee.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: orgId1,
          employeeCode: 'EMP-101',
          fullName: 'Sok Dara',
          normalizedPhone: '+855977429389',
          currentPositionId: 'pos-mason',
          status: 'ACTIVE',
        }),
      });

      // 2. Transactionally creates linked TelegramAccount
      expect(mockPrisma.telegramAccount.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: orgId1,
          employeeId: 'emp-999',
          telegramUserId: 'tg-101',
          status: 'ACTIVE',
        }),
      });

      // 3. Appends position history
      expect(mockPrisma.employeePositionHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: orgId1,
          employeeId: 'emp-999',
          positionId: 'pos-mason',
          source: 'MANAGER_ASSIGNED',
          assignedByUserId: 'user-admin-1',
        }),
      });

      // 4. Updates RegistrationRequest status
      expect(mockPrisma.registrationRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: expect.objectContaining({
          status: 'APPROVED',
          createdEmployeeId: 'emp-999',
        }),
      });

      // 5. Writes AuditLog
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'REGISTRATION_REQUEST_APPROVED',
          targetId: requestId,
        }),
      });

      // 6. Sends Telegram approval notification to worker
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        'tg-101',
        expect.stringContaining('Registration Approved'),
        'Markdown',
      );

      expect(res.status).toBe('APPROVED');
      expect(res.createdEmployeeId).toBe('emp-999');
    });

    it('rejecting request updates status to REJECTED and notifies worker via Telegram', async () => {
      const requestId = 'reg-102';
      mockPrisma.registrationRequest.findFirst.mockResolvedValue({
        id: requestId,
        organizationId: orgId1,
        telegramUserId: 'tg-102',
        phone: '+855977429390',
        normalizedPhone: '+855977429390',
        telegramUsername: 'unverified_user',
        telegramFirstName: 'Unverified',
        status: 'PENDING',
      });

      mockPrisma.registrationRequest.update.mockResolvedValue({
        id: requestId,
        status: 'REJECTED',
        reviewedAt: new Date(),
        reviewedByUserId: 'user-admin-1',
        reviewNote: 'Phone number not in corporate registry',
      });

      const res = await registrationRequestsController.resolveRequest(orgId1, adminUser1 as any, requestId, {
        approved: false,
        reviewNote: 'Phone number not in corporate registry',
      });

      expect(mockPrisma.employee.create).not.toHaveBeenCalled();
      expect(mockPrisma.telegramAccount.create).not.toHaveBeenCalled();
      expect(res.status).toBe('REJECTED');

      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        'tg-102',
        expect.stringContaining('Registration Request Update'),
        'Markdown',
      );
    });

    it('prevents resolving request if already resolved', async () => {
      mockPrisma.registrationRequest.findFirst.mockResolvedValue({
        id: 'reg-resolved',
        organizationId: orgId1,
        status: 'APPROVED',
      });

      await expect(
        registrationRequestsController.resolveRequest(orgId1, adminUser1 as any, 'reg-resolved', {
          approved: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('prevents cross-organization resolution', async () => {
      mockPrisma.registrationRequest.findFirst.mockResolvedValue(null);

      await expect(
        registrationRequestsController.resolveRequest(orgId1, adminUser1 as any, 'reg-other-org', {
          approved: true,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
