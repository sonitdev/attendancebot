import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsService } from '../src/analytics/analytics.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

describe('AnalyticsService - Cross-Project Performance and History', () => {
  let analyticsService: AnalyticsService;
  let mockPrisma: any;

  const sampleEmployee = {
    id: 'emp-101',
    organizationId: 'org-tenant-1',
    employeeCode: 'EMP-101',
    fullName: 'Sokha Chan',
    jobTitle: 'Site Technician',
    avatarUrl: 'https://t.me/i/userpic/sokha.jpg',
    telegramAccount: {
      username: 'sokhachan',
      photoUrl: 'https://t.me/i/userpic/sokha.jpg',
    },
  };

  const sampleRecords = [
    {
      id: 'rec-1',
      attendanceDate: new Date('2026-09-18T00:00:00.000Z'),
      checkInAt: new Date('2026-09-18T01:00:00.000Z'),
      checkOutAt: new Date('2026-09-18T09:00:00.000Z'),
      status: 'ON_TIME',
      checkInVerification: 'VERIFIED',
      workDurationMinutes: 480, // 8 hours
      assignment: {
        site: {
          id: 'site-alpha',
          name: 'Alpha Site 1',
          project: {
            id: 'prj-tower',
            code: 'PRJ-TOWER',
            name: 'Riverside Tower',
          },
        },
      },
    },
    {
      id: 'rec-2',
      attendanceDate: new Date('2026-09-17T00:00:00.000Z'),
      checkInAt: new Date('2026-09-17T01:30:00.000Z'),
      checkOutAt: new Date('2026-09-17T09:00:00.000Z'),
      status: 'LATE',
      checkInVerification: 'VERIFIED',
      workDurationMinutes: 450, // 7.5 hours
      assignment: {
        site: {
          id: 'site-alpha',
          name: 'Alpha Site 1',
          project: {
            id: 'prj-tower',
            code: 'PRJ-TOWER',
            name: 'Riverside Tower',
          },
        },
      },
    },
    {
      id: 'rec-3',
      attendanceDate: new Date('2026-09-16T00:00:00.000Z'),
      checkInAt: new Date('2026-09-16T01:00:00.000Z'),
      checkOutAt: new Date('2026-09-16T09:00:00.000Z'),
      status: 'ON_TIME',
      checkInVerification: 'VERIFIED',
      workDurationMinutes: 480, // 8 hours
      assignment: {
        site: {
          id: 'site-bridge',
          name: 'Bridge Pier 4',
          project: {
            id: 'prj-bridge',
            code: 'PRJ-BRIDGE',
            name: 'Chroy Changvar Bridge',
          },
        },
      },
    },
  ];

  beforeEach(() => {
    mockPrisma = {
      employee: {
        findFirst: vi.fn(),
      },
      attendanceRecord: {
        findMany: vi.fn(),
      },
      assignment: {
        findFirst: vi.fn(),
      },
    };

    analyticsService = new AnalyticsService(mockPrisma as unknown as PrismaService);
  });

  const sampleActiveAssignment = {
    id: 'asg-active',
    startsOn: new Date('2026-08-01T00:00:00.000Z'),
    site: {
      id: 'site-alpha',
      name: 'Alpha Site 1',
      allowedRadiusMeters: 100,
      timezone: 'Asia/Phnom_Penh',
      project: {
        id: 'prj-tower',
        code: 'PRJ-TOWER',
        name: 'Riverside Tower',
      },
    },
    schedule: {
      startTime: '08:00',
      endTime: '17:00',
    },
  };

  it('aggregates cross-project performance summary accurately', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue(sampleEmployee);
    mockPrisma.attendanceRecord.findMany.mockResolvedValue(sampleRecords);
    mockPrisma.assignment.findFirst.mockResolvedValue(sampleActiveAssignment);

    const analytics = await analyticsService.getEmployeeAnalytics('org-tenant-1', 'emp-101');

    // Verify employee profile
    expect(analytics.employee.fullName).toBe('Sokha Chan');
    expect(analytics.employee.avatarUrl).toBe('https://t.me/i/userpic/sokha.jpg');
    expect(analytics.employee.telegramUsername).toBe('sokhachan');

    // Verify summary
    expect(analytics.summary.totalShifts).toBe(3);
    expect(analytics.summary.totalWorkMinutes).toBe(1410); // 480 + 450 + 480
    expect(analytics.summary.totalWorkHours).toBe(23.5);
    expect(analytics.summary.onTimeCount).toBe(2);
    expect(analytics.summary.lateCount).toBe(1);
    expect(analytics.summary.onTimePercentage).toBe(67); // 2/3 = 66.67% -> 67%
    expect(analytics.summary.verifiedCount).toBe(3);
    expect(analytics.summary.exceptionCount).toBe(0);

    // Verify active project preview
    expect(analytics.activeProject).toBeDefined();
    expect(analytics.activeProject!.projectName).toBe('Riverside Tower');
    expect(analytics.activeProject!.siteName).toBe('Alpha Site 1');
    expect(analytics.activeProject!.allowedRadiusMeters).toBe(100);

    // Verify weekly attendance
    expect(analytics.weeklyAttendance).toBeDefined();
    expect(analytics.weeklyAttendance).toHaveLength(7);
    expect(analytics.weeklyStats).toBeDefined();

    // Verify project-by-project breakdown

    // Verify project-by-project breakdown
    expect(analytics.projectBreakdown).toHaveLength(2);

    const towerProject = analytics.projectBreakdown.find((p) => p.projectCode === 'PRJ-TOWER');
    expect(towerProject).toBeDefined();
    expect(towerProject!.shiftsCompleted).toBe(2);
    expect(towerProject!.totalWorkMinutes).toBe(930);
    expect(towerProject!.totalWorkHours).toBe(15.5);
    expect(towerProject!.onTimePercentage).toBe(50); // 1 on-time, 1 late

    const bridgeProject = analytics.projectBreakdown.find((p) => p.projectCode === 'PRJ-BRIDGE');
    expect(bridgeProject).toBeDefined();
    expect(bridgeProject!.shiftsCompleted).toBe(1);
    expect(bridgeProject!.totalWorkMinutes).toBe(480);
    expect(bridgeProject!.totalWorkHours).toBe(8.0);
    expect(bridgeProject!.onTimePercentage).toBe(100);

    // Verify recent history items
    expect(analytics.recentHistory).toHaveLength(3);
    expect(analytics.recentHistory[0]!.projectName).toBe('Riverside Tower');
    expect(analytics.recentHistory[0]!.siteName).toBe('Alpha Site 1');
  });

  it('handles worker with 0 shifts safely with 100% defaults', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue(sampleEmployee);
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([]);

    const analytics = await analyticsService.getEmployeeAnalytics('org-tenant-1', 'emp-101');

    expect(analytics.summary.totalShifts).toBe(0);
    expect(analytics.summary.totalWorkMinutes).toBe(0);
    expect(analytics.summary.totalWorkHours).toBe(0);
    expect(analytics.summary.onTimePercentage).toBe(100);
    expect(analytics.projectBreakdown).toHaveLength(0);
    expect(analytics.recentHistory).toHaveLength(0);
  });

  it('rejects cross-tenant analytics lookup with NotFoundException', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue(null); // Not found in this tenant

    await expect(
      analyticsService.getEmployeeAnalytics('org-tenant-OTHER', 'emp-101'),
    ).rejects.toThrow(NotFoundException);
  });

  it('fetches worker attendance history across projects', async () => {
    mockPrisma.attendanceRecord.findMany.mockResolvedValue(sampleRecords);

    const history = await analyticsService.getEmployeeAttendanceHistory('org-tenant-1', 'emp-101');

    expect(history).toHaveLength(3);
    expect(history[0]!.projectName).toBe('Riverside Tower');
    expect(history[0]!.status).toBe('ON_TIME');
    expect(history[0]!.workDurationMinutes).toBe(480);
  });
});
