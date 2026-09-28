import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerGroupsController } from '../src/worker-groups/worker-groups.controller.js';
import { WorkerGroupsService } from '../src/worker-groups/worker-groups.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

describe('Phase 4: Worker Groups & Membership History', () => {
  let workerGroupsService: WorkerGroupsService;
  let workerGroupsController: WorkerGroupsController;
  let mockPrisma: any;

  const orgId1 = 'org-acme';
  const adminUser1 = { userId: 'user-admin-1', organizationId: orgId1, email: 'pm@acme.com', roles: ['OWNER', 'PROJECT_MANAGER'] };

  beforeEach(() => {
    mockPrisma = {
      workerGroup: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      workerGroupMember: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn(),
      },
      employee: {
        findFirst: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
    };

    workerGroupsService = new WorkerGroupsService(mockPrisma as unknown as PrismaService);
    workerGroupsController = new WorkerGroupsController(workerGroupsService);
  });

  describe('Worker Group CRUD', () => {
    it('creates a worker group with tenant code uniqueness', async () => {
      mockPrisma.workerGroup.findUnique.mockResolvedValue(null);
      mockPrisma.workerGroup.create.mockResolvedValue({
        id: 'grp-1',
        organizationId: orgId1,
        code: 'ELEC_TEAM_A',
        name: 'Electrical Team A',
        description: 'Primary high-voltage installation team',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await workerGroupsController.createGroup(orgId1, adminUser1 as any, {
        code: 'ELEC_TEAM_A',
        name: 'Electrical Team A',
        description: 'Primary high-voltage installation team',
      });

      expect(mockPrisma.workerGroup.create).toHaveBeenCalledWith({
        data: {
          organizationId: orgId1,
          code: 'ELEC_TEAM_A',
          name: 'Electrical Team A',
          description: 'Primary high-voltage installation team',
        },
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'WORKER_GROUP_CREATED',
          targetId: 'grp-1',
        }),
      });

      expect(res.code).toBe('ELEC_TEAM_A');
    });

    it('rejects duplicate worker group code within the same organization', async () => {
      mockPrisma.workerGroup.findUnique.mockResolvedValue({ id: 'grp-existing', code: 'ELEC_TEAM_A' });

      await expect(
        workerGroupsController.createGroup(orgId1, adminUser1 as any, {
          code: 'ELEC_TEAM_A',
          name: 'Electrical Team A',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('lists worker groups including active member counts', async () => {
      mockPrisma.workerGroup.findMany.mockResolvedValue([
        {
          id: 'grp-1',
          code: 'ELEC_TEAM_A',
          name: 'Electrical Team A',
          description: null,
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { members: 5 },
        },
      ]);

      const list = await workerGroupsController.listGroups(orgId1);
      expect(mockPrisma.workerGroup.findMany).toHaveBeenCalledWith({
        where: { organizationId: orgId1 },
        include: {
          _count: { select: { members: { where: { leftAt: null } } } },
        },
        orderBy: { code: 'asc' },
      });

      expect(list[0].activeMembersCount).toBe(5);
    });
  });

  describe('Group Membership Management', () => {
    it('adds employees to group, preventing duplicate active memberships', async () => {
      mockPrisma.workerGroup.findFirst.mockResolvedValue({ id: 'grp-1', organizationId: orgId1 });
      mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-401', organizationId: orgId1 });
      mockPrisma.workerGroupMember.findFirst.mockResolvedValue(null); // Not active yet
      mockPrisma.workerGroupMember.create.mockResolvedValue({ id: 'mem-1' });

      const res = await workerGroupsController.addMembers(orgId1, adminUser1 as any, 'grp-1', {
        employeeIds: ['emp-401'],
      });

      expect(mockPrisma.workerGroupMember.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: orgId1,
          workerGroupId: 'grp-1',
          employeeId: 'emp-401',
          leftAt: null,
        }),
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'WORKER_GROUP_MEMBERS_ADDED',
          targetId: 'grp-1',
        }),
      });

      expect(res.addedCount).toBe(1);
    });

    it('removes employees from group by setting leftAt timestamp', async () => {
      mockPrisma.workerGroup.findFirst.mockResolvedValue({ id: 'grp-1', organizationId: orgId1 });
      mockPrisma.workerGroupMember.updateMany.mockResolvedValue({ count: 2 });

      const res = await workerGroupsController.removeMembers(orgId1, adminUser1 as any, 'grp-1', {
        employeeIds: ['emp-401', 'emp-402'],
      });

      expect(mockPrisma.workerGroupMember.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId: orgId1,
          workerGroupId: 'grp-1',
          employeeId: { in: ['emp-401', 'emp-402'] },
          leftAt: null,
        },
        data: {
          leftAt: expect.any(Date),
        },
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'WORKER_GROUP_MEMBERS_REMOVED',
          targetId: 'grp-1',
        }),
      });

      expect(res.removedCount).toBe(2);
    });
  });

  describe('Tenant Boundary Protection', () => {
    it('prevents manager from adding members to a worker group of another organization', async () => {
      mockPrisma.workerGroup.findFirst.mockResolvedValue(null); // Not found in Org 1

      await expect(
        workerGroupsController.addMembers(orgId1, adminUser1 as any, 'grp-globex-999', {
          employeeIds: ['emp-401'],
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
