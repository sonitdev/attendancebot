import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PositionRequestsController } from '../src/position-requests/position-requests.controller.js';
import { PositionRequestsService } from '../src/position-requests/position-requests.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

describe('Phase 3: Position Request & Manager Approval Workflow', () => {
  let positionRequestsService: PositionRequestsService;
  let positionRequestsController: PositionRequestsController;
  let mockPrisma: any;

  const orgId1 = 'org-acme';
  const orgId2 = 'org-globex';
  const workerPrincipal = { type: 'worker', employeeId: 'emp-301', organizationId: orgId1, telegramUserId: 'tg-301' };
  const adminUser1 = { userId: 'user-admin-1', organizationId: orgId1, email: 'hr@acme.com', roles: ['OWNER', 'HR'] };

  beforeEach(() => {
    mockPrisma = {
      employee: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      position: {
        findFirst: vi.fn(),
      },
      positionRequest: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      employeePositionHistory: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
    };

    positionRequestsService = new PositionRequestsService(mockPrisma as unknown as PrismaService);
    positionRequestsController = new PositionRequestsController(positionRequestsService);
  });

  describe('Worker Position Request Submission', () => {
    it('creates position request with PENDING status without modifying current position', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-301', organizationId: orgId1, currentPositionId: 'pos-general' });
      mockPrisma.position.findFirst.mockResolvedValue({ id: 'pos-elec', organizationId: orgId1, name: 'Electrician', status: 'ACTIVE' });
      mockPrisma.positionRequest.findFirst.mockResolvedValue(null);

      mockPrisma.positionRequest.create.mockResolvedValue({
        id: 'req-1',
        organizationId: orgId1,
        employeeId: 'emp-301',
        requestedPositionId: 'pos-elec',
        status: 'PENDING',
        requestedAt: new Date(),
        requestedPosition: { id: 'pos-elec', code: 'ELECTRICIAN', name: 'Electrician' },
      });

      const request = await positionRequestsController.createRequest(orgId1, workerPrincipal as any, {
        requestedPositionId: 'pos-elec',
      });

      expect(mockPrisma.positionRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: orgId1,
          employeeId: 'emp-301',
          requestedPositionId: 'pos-elec',
          status: 'PENDING',
        }),
        include: { requestedPosition: true },
      });

      // Employee current position MUST NOT be updated upon request submission (Amendment 4 requirement)
      expect(mockPrisma.employee.update).not.toHaveBeenCalled();
      expect(mockPrisma.employeePositionHistory.create).not.toHaveBeenCalled();

      expect(request.status).toBe('PENDING');
    });

    it('rejects position request submission if worker already has a PENDING request', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-301', organizationId: orgId1 });
      mockPrisma.position.findFirst.mockResolvedValue({ id: 'pos-elec', organizationId: orgId1, status: 'ACTIVE' });
      mockPrisma.positionRequest.findFirst.mockResolvedValue({ id: 'req-pending', status: 'PENDING' });

      await expect(
        positionRequestsController.createRequest(orgId1, workerPrincipal as any, {
          requestedPositionId: 'pos-elec',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects position request for inactive job position', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-301', organizationId: orgId1 });
      mockPrisma.position.findFirst.mockResolvedValue({ id: 'pos-retired', organizationId: orgId1, name: 'Retired', status: 'INACTIVE' });

      await expect(
        positionRequestsController.createRequest(orgId1, workerPrincipal as any, {
          requestedPositionId: 'pos-retired',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Manager Resolution (Approval & Rejection Workflow)', () => {
    it('approving request transactionally updates history, cache, request status, and writes audit log', async () => {
      const requestId = 'req-101';
      mockPrisma.positionRequest.findFirst.mockResolvedValue({
        id: requestId,
        organizationId: orgId1,
        employeeId: 'emp-301',
        requestedPositionId: 'pos-elec',
        status: 'PENDING',
        employee: { id: 'emp-301', currentPositionId: 'pos-general' },
        requestedPosition: { id: 'pos-elec', code: 'ELECTRICIAN', name: 'Electrician' },
      });

      mockPrisma.employeePositionHistory.findFirst.mockResolvedValue({
        id: 'hist-open',
        organizationId: orgId1,
        employeeId: 'emp-301',
        effectiveFrom: new Date('2026-01-01'),
        effectiveTo: null,
      });

      mockPrisma.employeePositionHistory.create.mockResolvedValue({
        id: 'hist-new-approved',
        organizationId: orgId1,
        employeeId: 'emp-301',
        positionId: 'pos-elec',
        effectiveFrom: new Date(),
        effectiveTo: null,
        source: 'WORKER_REQUEST_APPROVED',
        assignedByUserId: 'user-admin-1',
      });

      mockPrisma.positionRequest.update.mockResolvedValue({
        id: requestId,
        status: 'APPROVED',
        reviewedAt: new Date(),
        reviewedByUserId: 'user-admin-1',
        reviewNote: 'Qualifications verified',
      });

      const res = await positionRequestsController.resolveRequest(orgId1, adminUser1 as any, requestId, {
        approved: true,
        reviewNote: 'Qualifications verified',
      });

      // 1. Closes active history
      expect(mockPrisma.employeePositionHistory.update).toHaveBeenCalledWith({
        where: { id: 'hist-open' },
        data: { effectiveTo: expect.any(Date) },
      });

      // 2. Appends new history with source WORKER_REQUEST_APPROVED
      expect(mockPrisma.employeePositionHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: orgId1,
          employeeId: 'emp-301',
          positionId: 'pos-elec',
          source: 'WORKER_REQUEST_APPROVED',
          assignedByUserId: 'user-admin-1',
        }),
      });

      // 3. Updates currentPositionId cache
      expect(mockPrisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp-301' },
        data: { currentPositionId: 'pos-elec' },
      });

      // 4. Updates PositionRequest status
      expect(mockPrisma.positionRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: expect.objectContaining({
          status: 'APPROVED',
          reviewedByUserId: 'user-admin-1',
          reviewNote: 'Qualifications verified',
        }),
        include: { employee: true, requestedPosition: true },
      });

      // 5. Writes AuditLog
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'POSITION_REQUEST_APPROVED',
          targetId: requestId,
        }),
      });

      expect(res.status).toBe('APPROVED');
    });

    it('rejecting request updates status to REJECTED, preserves record, and DOES NOT alter position history/cache', async () => {
      const requestId = 'req-102';
      mockPrisma.positionRequest.findFirst.mockResolvedValue({
        id: requestId,
        organizationId: orgId1,
        employeeId: 'emp-301',
        requestedPositionId: 'pos-plumb',
        status: 'PENDING',
        employee: { id: 'emp-301', currentPositionId: 'pos-general' },
        requestedPosition: { id: 'pos-plumb', code: 'PLUMBER', name: 'Plumber' },
      });

      mockPrisma.positionRequest.update.mockResolvedValue({
        id: requestId,
        status: 'REJECTED',
        reviewedAt: new Date(),
        reviewedByUserId: 'user-admin-1',
        reviewNote: 'Missing trade license',
      });

      const res = await positionRequestsController.resolveRequest(orgId1, adminUser1 as any, requestId, {
        approved: false,
        reviewNote: 'Missing trade license',
      });

      // Position history and currentPositionId cache MUST NOT be changed on rejection
      expect(mockPrisma.employeePositionHistory.create).not.toHaveBeenCalled();
      expect(mockPrisma.employee.update).not.toHaveBeenCalled();

      // Request record IS preserved in DB with status REJECTED
      expect(mockPrisma.positionRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: expect.objectContaining({
          status: 'REJECTED',
          reviewedByUserId: 'user-admin-1',
          reviewNote: 'Missing trade license',
        }),
        include: { employee: true, requestedPosition: true },
      });

      // Writes AuditLog
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'POSITION_REQUEST_REJECTED',
          targetId: requestId,
        }),
      });

      expect(res.status).toBe('REJECTED');
    });
  });

  describe('Tenant Boundary Protection', () => {
    it('prevents manager from resolving position request from another organization', async () => {
      mockPrisma.positionRequest.findFirst.mockResolvedValue(null); // Not found in Org 1

      await expect(
        positionRequestsController.resolveRequest(orgId1, adminUser1 as any, 'req-globex-999', {
          approved: true,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
