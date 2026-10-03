import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AdminPrincipal } from './principal.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AdminDataScope {
  unrestricted: boolean;
  projectIds: string[];
  siteIds: string[];
}

@Injectable()
export class AdminScopeService {
  constructor(private readonly prisma: PrismaService) {}

  isUnrestricted(principal: AdminPrincipal): boolean {
    return principal.roles.includes('OWNER') || principal.roles.includes('HR');
  }

  async resolve(principal: AdminPrincipal): Promise<AdminDataScope> {
    if (this.isUnrestricted(principal)) {
      return { unrestricted: true, projectIds: [], siteIds: [] };
    }

    const [projectScopes, siteScopes] = await Promise.all([
      this.prisma.userProjectScope.findMany({
        where: { organizationId: principal.organizationId, userId: principal.userId },
        select: { projectId: true },
      }),
      this.prisma.userSiteScope.findMany({
        where: { organizationId: principal.organizationId, userId: principal.userId },
        select: { siteId: true, site: { select: { projectId: true } } },
      }),
    ]);

    return {
      unrestricted: false,
      projectIds: [...new Set([...projectScopes.map((item) => item.projectId), ...siteScopes.map((item) => item.site.projectId)])],
      siteIds: siteScopes.map((item) => item.siteId),
    };
  }

  async assertProject(principal: AdminPrincipal, projectId: string): Promise<void> {
    const scope = await this.resolve(principal);
    if (!scope.unrestricted && !scope.projectIds.includes(projectId)) {
      throw new ForbiddenException('FORBIDDEN_PROJECT_SCOPE');
    }
  }

  async assertSite(principal: AdminPrincipal, siteId: string): Promise<void> {
    const scope = await this.resolve(principal);
    if (scope.unrestricted) return;
    if (scope.siteIds.includes(siteId)) return;
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, organizationId: principal.organizationId },
      select: { projectId: true },
    });
    if (!site || !scope.projectIds.includes(site.projectId)) {
      throw new ForbiddenException('FORBIDDEN_SITE_SCOPE');
    }
  }

  async assertAssignment(principal: AdminPrincipal, assignmentId: string): Promise<void> {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: assignmentId, organizationId: principal.organizationId },
      select: { siteId: true },
    });
    if (!assignment) throw new ForbiddenException('FORBIDDEN_ASSIGNMENT_SCOPE');
    await this.assertSite(principal, assignment.siteId);
  }

  async assertEmployee(principal: AdminPrincipal, employeeId: string): Promise<void> {
    const scope = await this.resolve(principal);
    if (scope.unrestricted) return;
    const visible = await this.prisma.employee.findFirst({
      where: {
        id: employeeId,
        organizationId: principal.organizationId,
        OR: [
          { currentProjectId: { in: scope.projectIds } },
          { assignments: { some: { site: { OR: [{ projectId: { in: scope.projectIds } }, { id: { in: scope.siteIds } }] } } } },
        ],
      },
      select: { id: true },
    });
    if (!visible) throw new ForbiddenException('FORBIDDEN_EMPLOYEE_SCOPE');
  }

  async assertAttendance(principal: AdminPrincipal, attendanceId: string): Promise<void> {
    const scope = await this.resolve(principal);
    if (scope.unrestricted) return;
    const visible = await this.prisma.attendanceRecord.findFirst({
      where: {
        id: attendanceId,
        organizationId: principal.organizationId,
        OR: [
          { projectId: { in: scope.projectIds } },
          { adjustedProjectId: { in: scope.projectIds } },
          { siteId: { in: scope.siteIds } },
        ],
      },
      select: { id: true },
    });
    if (!visible) throw new ForbiddenException('FORBIDDEN_ATTENDANCE_SCOPE');
  }

  async assertOutlet(principal: AdminPrincipal, outletId: string): Promise<void> {
    const outlet = await this.prisma.outlet.findFirst({
      where: { id: outletId, organizationId: principal.organizationId },
      select: { projectId: true },
    });
    if (!outlet) throw new ForbiddenException('FORBIDDEN_OUTLET_SCOPE');
    await this.assertProject(principal, outlet.projectId);
  }

  async assertSalesReport(principal: AdminPrincipal, reportId: string): Promise<void> {
    const report = await this.prisma.dailySalesReport.findFirst({
      where: { id: reportId, organizationId: principal.organizationId },
      select: { projectId: true },
    });
    if (!report) throw new ForbiddenException('FORBIDDEN_REPORT_SCOPE');
    await this.assertProject(principal, report.projectId);
  }

  async assertCorrection(principal: AdminPrincipal, correctionId: string): Promise<void> {
    const correction = await this.prisma.attendanceCorrection.findFirst({
      where: { id: correctionId, organizationId: principal.organizationId },
      select: { attendanceRecordId: true },
    });
    if (!correction) throw new ForbiddenException('FORBIDDEN_CORRECTION_SCOPE');
    await this.assertAttendance(principal, correction.attendanceRecordId);
  }
}
