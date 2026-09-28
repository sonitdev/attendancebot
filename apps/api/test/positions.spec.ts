import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PositionsController } from '../src/positions/positions.controller.js';
import { PositionsService } from '../src/positions/positions.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

describe('Phase 1: Position Foundation & Position History', () => {
  let positionsService: PositionsService;
  let positionsController: PositionsController;
  let mockPrisma: any;

  const orgId1 = 'org-acme';
  const orgId2 = 'org-globex';
  const adminUser1 = { userId: 'user-admin-1', organizationId: orgId1, email: 'admin@acme.com', roles: ['OWNER', 'HR'] };

  beforeEach(() => {
    mockPrisma = {
      position: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      employee: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      employeePositionHistory: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
    };

    positionsService = new PositionsService(mockPrisma as unknown as PrismaService);
    positionsController = new PositionsController(positionsService);
  });

  describe('Position CRUD', () => {
    it('creates a job position for tenant and writes audit log', async () => {
      mockPrisma.position.findUnique.mockResolvedValue(null);
      mockPrisma.position.create.mockResolvedValue({
        id: 'pos-elec',
        organizationId: orgId1,
        code: 'ELECTRICIAN',
        name: 'Licensed Electrician',
        description: 'High-voltage site wiring specialist',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await positionsController.createPosition(orgId1, adminUser1 as any, {
        code: 'ELECTRICIAN',
        name: 'Licensed Electrician',
        description: 'High-voltage site wiring specialist',
      });

      expect(mockPrisma.position.create).toHaveBeenCalledWith({
        data: {
          organizationId: orgId1,
          code: 'ELECTRICIAN',
          name: 'Licensed Electrician',
          description: 'High-voltage site wiring specialist',
        },
      });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          organizationId: orgId1,
          actorUserId: 'user-admin-1',
          action: 'POSITION_CREATED',
          targetType: 'Position',
          targetId: 'pos-elec',
          metadata: { code: 'ELECTRICIAN', name: 'Licensed Electrician' },
        },
      });
      expect(result.code).toBe('ELECTRICIAN');
    });

    it('rejects duplicate position code within the same organization', async () => {
      mockPrisma.position.findUnique.mockResolvedValue({ id: 'existing-pos', code: 'ELECTRICIAN' });

      await expect(
        positionsController.createPosition(orgId1, adminUser1 as any, {
          code: 'ELECTRICIAN',
          name: 'Electrician',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('lists positions filtered strictly by organizationId', async () => {
      mockPrisma.position.findMany.mockResolvedValue([
        { id: 'pos-1', code: 'ELECTRICIAN', name: 'Electrician' },
        { id: 'pos-2', code: 'PLUMBER', name: 'Plumber' },
      ]);

      const list = await positionsController.listPositions(orgId1);
      expect(mockPrisma.position.findMany).toHaveBeenCalledWith({
        where: { organizationId: orgId1 },
        orderBy: { code: 'asc' },
      });
      expect(list).toHaveLength(2);
    });
  });

  describe('Official Employee Position Assignment', () => {
    it('transactionally closes prior open history, appends new history record, updates cache, and creates audit log', async () => {
      const empId = 'emp-101';
      const posId = 'pos-plumb';
      const effectiveFrom = '2026-09-19T00:00:00.000Z';

      mockPrisma.employee.findFirst.mockResolvedValue({
        id: empId,
        organizationId: orgId1,
        fullName: 'Worker One',
        currentPositionId: 'pos-elec',
      });

      mockPrisma.position.findFirst.mockResolvedValue({
        id: posId,
        organizationId: orgId1,
        name: 'Plumber',
        status: 'ACTIVE',
      });

      mockPrisma.employeePositionHistory.findFirst.mockResolvedValue({
        id: 'hist-prior',
        organizationId: orgId1,
        employeeId: empId,
        positionId: 'pos-elec',
        effectiveFrom: new Date('2026-01-01'),
        effectiveTo: null,
      });

      mockPrisma.employeePositionHistory.create.mockResolvedValue({
        id: 'hist-new',
        organizationId: orgId1,
        employeeId: empId,
        positionId: posId,
        effectiveFrom: new Date(effectiveFrom),
        effectiveTo: null,
        source: 'MANAGER_ASSIGNED',
        assignedByUserId: 'user-admin-1',
      });

      mockPrisma.employee.update.mockResolvedValue({
        id: empId,
        currentPositionId: posId,
        currentPosition: { id: posId, code: 'PLUMBER', name: 'Plumber' },
      });

      const result = await positionsController.assignEmployeePosition(orgId1, adminUser1 as any, empId, {
        positionId: posId,
        effectiveFrom,
      });

      // 1. Verify prior open history record was closed
      expect(mockPrisma.employeePositionHistory.update).toHaveBeenCalledWith({
        where: { id: 'hist-prior' },
        data: { effectiveTo: new Date(effectiveFrom) },
      });

      // 2. Verify new history record created
      expect(mockPrisma.employeePositionHistory.create).toHaveBeenCalledWith({
        data: {
          organizationId: orgId1,
          employeeId: empId,
          positionId: posId,
          effectiveFrom: new Date(effectiveFrom),
          effectiveTo: null,
          source: 'MANAGER_ASSIGNED',
          assignedByUserId: 'user-admin-1',
        },
      });

      // 3. Verify read-model cache update
      expect(mockPrisma.employee.update).toHaveBeenCalledWith({
        where: { id: empId },
        data: { currentPositionId: posId },
        include: { currentPosition: true },
      });

      // 4. Verify Audit Log entry
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          organizationId: orgId1,
          actorUserId: 'user-admin-1',
          action: 'EMPLOYEE_POSITION_ASSIGNED',
          targetType: 'Employee',
          targetId: empId,
          metadata: {
            previousPositionId: 'pos-elec',
            newPositionId: posId,
            historyRecordId: 'hist-new',
            effectiveFrom: new Date(effectiveFrom).toISOString(),
          },
        },
      });

      expect(result.employee.currentPositionId).toBe(posId);
      expect(result.historyRecord.id).toBe('hist-new');
    });

    it('rejects assignment of inactive position', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-101', organizationId: orgId1 });
      mockPrisma.position.findFirst.mockResolvedValue({ id: 'pos-inactive', organizationId: orgId1, name: 'Retired', status: 'INACTIVE' });

      await expect(
        positionsController.assignEmployeePosition(orgId1, adminUser1 as any, 'emp-101', {
          positionId: 'pos-inactive',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Security & Multi-Tenant Boundary Tests (Required Security Requirement #4)', () => {
    it('prevents manager from assigning a position belonging to another organization, even if positionId is known', async () => {
      // Employee belongs to Org 1
      mockPrisma.employee.findFirst.mockResolvedValue({
        id: 'emp-101',
        organizationId: orgId1,
      });

      // Target position belongs to Org 2 (Globex)
      mockPrisma.position.findFirst.mockImplementation((args: any) => {
        if (args.where.organizationId === orgId1 && args.where.id === 'pos-globex-secret') {
          return Promise.resolve(null); // Not found in Org 1
        }
        return Promise.resolve(null);
      });

      await expect(
        positionsController.assignEmployeePosition(orgId1, adminUser1 as any, 'emp-101', {
          positionId: 'pos-globex-secret',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('prevents manager from assigning position to an employee of another organization', async () => {
      // Employee belongs to Org 2, not Org 1
      mockPrisma.employee.findFirst.mockImplementation((args: any) => {
        if (args.where.organizationId === orgId1 && args.where.id === 'emp-globex-202') {
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      });

      await expect(
        positionsController.assignEmployeePosition(orgId1, adminUser1 as any, 'emp-globex-202', {
          positionId: 'pos-acme-1',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
