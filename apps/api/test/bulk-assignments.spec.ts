import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BulkAssignmentsController } from '../src/assignments/bulk-assignments.controller.js';
import { BulkAssignmentsService } from '../src/assignments/bulk-assignments.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

describe('Phase 5: Bulk Preview/Apply API with Conflict Rules & Idempotency', () => {
  let bulkAssignmentsService: BulkAssignmentsService;
  let bulkAssignmentsController: BulkAssignmentsController;
  let mockPrisma: any;

  const orgId1 = 'org-acme';
  const adminUser1 = { userId: 'user-admin-1', organizationId: orgId1, email: 'pm@acme.com', roles: ['OWNER', 'PROJECT_MANAGER'] };

  beforeEach(() => {
    mockPrisma = {
      site: {
        findFirst: vi.fn(),
      },
      workSchedule: {
        findFirst: vi.fn(),
      },
      workerGroupMember: {
        findMany: vi.fn(),
      },
      employee: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      assignment: {
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      bulkAssignmentBatch: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      bulkAssignmentResult: {
        createMany: vi.fn(),
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
    };

    bulkAssignmentsService = new BulkAssignmentsService(mockPrisma as unknown as PrismaService);
    bulkAssignmentsController = new BulkAssignmentsController(bulkAssignmentsService);
  });

  describe('Bulk Preview Generation & Conflict Evaluation', () => {
    it('generates server-side preview token and evaluates worker conflicts accurately', async () => {
      mockPrisma.site.findFirst.mockResolvedValue({ id: 'site-1', name: 'Riverside Site' });
      mockPrisma.workSchedule.findFirst.mockResolvedValue({ id: 'sched-1', name: 'Standard Day Shift' });

      mockPrisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1', employeeCode: 'EMP-001', fullName: 'Worker One', status: 'ACTIVE' },
        { id: 'emp-2', employeeCode: 'EMP-002', fullName: 'Worker Two', status: 'INACTIVE' },
        { id: 'emp-3', employeeCode: 'EMP-003', fullName: 'Worker Three', status: 'ACTIVE' },
      ]);

      // emp-1 has no overlapping assignment
      // emp-3 has overlapping active assignment WITH attendance facts
      mockPrisma.assignment.findMany.mockImplementation((args: any) => {
        if (args.where.employeeId === 'emp-3') {
          return Promise.resolve([
            { id: 'assign-old', status: 'ACTIVE', attendance: [{ id: 'att-1' }] },
          ]);
        }
        return Promise.resolve([]);
      });

      mockPrisma.bulkAssignmentBatch.create.mockImplementation((args: any) => {
        return Promise.resolve({
          id: 'batch-preview-1',
          ...args.data,
        });
      });

      const res = await bulkAssignmentsController.previewAssignments(orgId1, adminUser1 as any, {
        employeeIds: ['emp-1', 'emp-2', 'emp-3'],
        siteId: 'site-1',
        scheduleId: 'sched-1',
        startsOn: '2026-10-01',
      });

      expect(res.previewId).toBeDefined();
      expect(res.previewId.startsWith('prev_')).toBe(true);
      expect(res.summary.totalTargetWorkers).toBe(3);
      expect(res.summary.readyCount).toBe(1);
      expect(res.summary.inactiveCount).toBe(1);
      expect(res.summary.conflictCount).toBe(1);

      const emp3Result = res.results.find((r) => r.employeeId === 'emp-3');
      expect(emp3Result?.status).toBe('SKIPPED_CONFLICT');
      expect(emp3Result?.reasonCode).toBe('ASSIGNMENT_HAS_ATTENDANCE_FACTS');
    });

    it('enforces 1,000 worker max limit per batch', async () => {
      mockPrisma.site.findFirst.mockResolvedValue({ id: 'site-1' });
      mockPrisma.workSchedule.findFirst.mockResolvedValue({ id: 'sched-1' });

      const fake1001Workers = Array.from({ length: 1001 }, (_, i) => `emp-${i}`);

      await expect(
        bulkAssignmentsController.previewAssignments(orgId1, adminUser1 as any, {
          employeeIds: fake1001Workers,
          siteId: 'site-1',
          scheduleId: 'sched-1',
          startsOn: '2026-10-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('handles transferOption: allows transfer if prior assignment has NO attendance facts', async () => {
      mockPrisma.site.findFirst.mockResolvedValue({ id: 'site-1', name: 'Riverside' });
      mockPrisma.workSchedule.findFirst.mockResolvedValue({ id: 'sched-1', name: 'Standard Day' });

      mockPrisma.employee.findMany.mockResolvedValue([
        { id: 'emp-transfer', employeeCode: 'EMP-TR', fullName: 'Transfer Worker', status: 'ACTIVE' },
      ]);

      // Overlapping assignment with NO attendance facts
      mockPrisma.assignment.findMany.mockResolvedValue([
        { id: 'assign-prior', status: 'ACTIVE', attendance: [] },
      ]);

      mockPrisma.bulkAssignmentBatch.create.mockImplementation((args: any) => Promise.resolve({ id: 'batch-1', ...args.data }));

      const res = await bulkAssignmentsController.previewAssignments(orgId1, adminUser1 as any, {
        employeeIds: ['emp-transfer'],
        siteId: 'site-1',
        scheduleId: 'sched-1',
        startsOn: '2026-10-01',
        transferOption: true,
      });

      expect(res.summary.readyCount).toBe(1);
      expect(res.results[0].status).toBe('CREATED');
      expect(res.results[0].reasonCode).toBe('TRANSFER_ELIGIBLE');
    });
  });

  describe('Bulk Apply Execution & Idempotency', () => {
    it('applies preview snapshot transactionally and creates individual assignment records', async () => {
      mockPrisma.bulkAssignmentBatch.findUnique.mockResolvedValue(null);

      const previewExpiresAt = new Date(Date.now() + 300000);
      mockPrisma.bulkAssignmentBatch.findFirst.mockResolvedValue({
        id: 'batch-1',
        organizationId: orgId1,
        targetSiteId: 'site-1',
        scheduleId: 'sched-1',
        startsOn: new Date('2026-10-01'),
        endsOn: null,
        transferOption: false,
        previewId: 'prev_123',
        previewExpiresAt,
        status: 'PREVIEW_GENERATED',
        results: [
          { id: 'res-1', employeeId: 'emp-1', status: 'CREATED', employee: { id: 'emp-1', employeeCode: 'EMP-001' } },
        ],
      });

      mockPrisma.assignment.create.mockResolvedValue({ id: 'new-assign-1' });

      const res = await bulkAssignmentsController.applyAssignments(
        orgId1,
        adminUser1 as any,
        { previewId: 'prev_123', idempotencyKey: 'idemp-key-999' },
        'idemp-key-999',
      );

      expect(mockPrisma.assignment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: orgId1,
          employeeId: 'emp-1',
          siteId: 'site-1',
          scheduleId: 'sched-1',
          status: 'ACTIVE',
        }),
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'BULK_ASSIGNMENT_APPLIED',
          targetId: 'batch-1',
        }),
      });

      expect(res.createdCount).toBe(1);
      expect(res.status).toBe('COMPLETED');
    });

    it('rejects apply request if preview token has expired', async () => {
      mockPrisma.bulkAssignmentBatch.findUnique.mockResolvedValue(null);

      const expiredTime = new Date(Date.now() - 5000); // 5 seconds ago
      mockPrisma.bulkAssignmentBatch.findFirst.mockResolvedValue({
        id: 'batch-expired',
        organizationId: orgId1,
        previewId: 'prev_expired',
        previewExpiresAt: expiredTime,
        status: 'PREVIEW_GENERATED',
        results: [],
      });

      await expect(
        bulkAssignmentsController.applyAssignments(
          orgId1,
          adminUser1 as any,
          { previewId: 'prev_expired', idempotencyKey: 'idemp-exp' },
          'idemp-exp',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('handles idempotent retry gracefully without creating duplicate assignments', async () => {
      mockPrisma.bulkAssignmentBatch.findUnique.mockResolvedValue({
        id: 'batch-completed',
        organizationId: orgId1,
        status: 'COMPLETED',
        results: [
          { id: 'res-1', status: 'CREATED' },
        ],
      });

      const res = await bulkAssignmentsController.applyAssignments(
        orgId1,
        adminUser1 as any,
        { previewId: 'prev_completed', idempotencyKey: 'idemp-retry-100' },
        'idemp-retry-100',
      );

      // Must NOT create duplicate assignments
      expect(mockPrisma.assignment.create).not.toHaveBeenCalled();

      expect(res.status).toBe('COMPLETED');
      expect(res.message).toContain('already completed');
    });
  });
});
