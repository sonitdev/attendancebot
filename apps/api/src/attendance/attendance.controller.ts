import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  adminAttendanceQuerySchema,
  attendanceExportQuerySchema,
  attendanceCheckInSchema,
  attendanceLocationSchema,
  createCorrectionSchema,
  resolveCorrectionSchema,
  type AttendanceActionResponse,
} from '@workforce/contracts';
import {
  CurrentAdmin,
  CurrentOrganizationId,
  CurrentWorker,
} from '../auth/decorators/principal.decorator.js';
import { RequireRoles } from '../auth/decorators/rbac.decorators.js';
import type { AdminPrincipal, WorkerPrincipal } from '../auth/principal.js';
import { AttendanceService } from './attendance.service.js';
import { CorrectionService } from './correction.service.js';

@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly correctionService: CorrectionService,
  ) {}

  @Post('check-in')
  @HttpCode(HttpStatus.OK)
  async checkIn(
    @CurrentWorker() worker: WorkerPrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<AttendanceActionResponse> {
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('MISSING_IDEMPOTENCY_KEY');
    }

    const parseResult = attendanceCheckInSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        errors: parseResult.error.errors,
      });
    }

    return this.attendanceService.checkIn(worker, parseResult.data, idempotencyKey.trim());
  }

  @Post('check-out')
  @HttpCode(HttpStatus.OK)
  async checkOut(
    @CurrentWorker() worker: WorkerPrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<AttendanceActionResponse> {
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('MISSING_IDEMPOTENCY_KEY');
    }

    const parseResult = attendanceLocationSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        errors: parseResult.error.errors,
      });
    }

    return this.attendanceService.checkOut(worker, parseResult.data, idempotencyKey.trim());
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Get('today')
  async getTodayAttendance(
    @CurrentOrganizationId() organizationId: string,
    @Query() query: unknown,
  ) {
    const parseResult = adminAttendanceQuerySchema.safeParse(query);
    const validatedQuery = parseResult.success ? parseResult.data : {};
    return this.attendanceService.getTodayAttendanceForAdmin(organizationId, validatedQuery);
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Get('exceptions')
  async getExceptions(
    @CurrentOrganizationId() organizationId: string,
    @Query('siteId') siteId?: string,
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
  ) {
    return this.correctionService.listExceptions(organizationId, { siteId, projectId, status });
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Get('export')
  async exportAttendance(
    @CurrentOrganizationId() organizationId: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) res: any,
  ) {
    const parseResult = attendanceExportQuerySchema.safeParse(query);
    const validatedQuery = parseResult.success ? parseResult.data : { format: 'json' as const };
    const result = await this.correctionService.exportAttendanceRecords(
      organizationId,
      validatedQuery,
    );

    if (result.format === 'csv') {
      if (typeof res?.header === 'function') {
        res.header('Content-Type', 'text/csv; charset=utf-8');
        res.header('Content-Disposition', 'attachment; filename="attendance-export.csv"');
      } else if (typeof res?.setHeader === 'function') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="attendance-export.csv"');
      }
      return result.data;
    }

    return result.data;
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Post('corrections/:id/resolve')
  async resolveCorrection(
    @CurrentOrganizationId() organizationId: string,
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parseResult = resolveCorrectionSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        errors: parseResult.error.errors,
      });
    }
    return this.correctionService.resolveCorrection(
      organizationId,
      id,
      parseResult.data,
      admin.userId,
    );
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Post(':id/corrections')
  async createCorrection(
    @CurrentOrganizationId() organizationId: string,
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parseResult = createCorrectionSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        errors: parseResult.error.errors,
      });
    }
    return this.correctionService.createCorrection(
      organizationId,
      id,
      parseResult.data,
      admin.userId,
    );
  }

  @RequireRoles('OWNER', 'HR', 'PROJECT_MANAGER', 'SITE_MANAGER')
  @Get(':id')
  async getAttendanceDetail(
    @CurrentOrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.attendanceService.getAttendanceDetailForAdmin(organizationId, id);
  }
}
