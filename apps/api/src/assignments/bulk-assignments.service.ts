import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  BulkAssignmentApplyInput,
  BulkAssignmentPreviewInput,
} from '@workforce/contracts';
import { BulkBatchStatus, BulkResultStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class BulkAssignmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async previewAssignments(
    orgId: string,
    input: BulkAssignmentPreviewInput,
    actorUserId: string,
  ) {
    // 1. Validate site & schedule belong to organization
    const site = await this.prisma.site.findFirst({
      where: { id: input.siteId, organizationId: orgId },
    });
    if (!site) throw new NotFoundException(`Site '${input.siteId}' not found`);

    const schedule = await this.prisma.workSchedule.findFirst({
      where: { id: input.scheduleId, organizationId: orgId },
    });
    if (!schedule) throw new NotFoundException(`Schedule '${input.scheduleId}' not found`);

    // 2. Resolve target worker IDs (Worker Group or Direct Selection)
    let targetWorkerIds: string[] = [];
    if (input.workerGroupId) {
      const activeMembers = await this.prisma.workerGroupMember.findMany({
        where: {
          organizationId: orgId,
          workerGroupId: input.workerGroupId,
          leftAt: null,
        },
        select: { employeeId: true },
      });
      targetWorkerIds = activeMembers.map((m) => m.employeeId);
    } else if (input.employeeIds && input.employeeIds.length > 0) {
      targetWorkerIds = input.employeeIds;
    }

    if (targetWorkerIds.length === 0) {
      throw new BadRequestException('NO_TARGET_WORKERS_SELECTED');
    }

    // Scale Architecture Amendment 8: Maximum 1,000 workers per batch
    if (targetWorkerIds.length > 1000) {
      throw new BadRequestException('BATCH_SIZE_EXCEEDS_LIMIT_1000');
    }

    const startsOnDate = new Date(input.startsOn);
    const endsOnDate = input.endsOn ? new Date(input.endsOn) : null;

    if (endsOnDate && endsOnDate < startsOnDate) {
      throw new BadRequestException('ENDS_ON_BEFORE_STARTS_ON');
    }

    const previewId = `prev_${randomUUID().replace(/-/g, '')}`;
    const previewExpiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 mins expiry

    // 3. Evaluate each target worker against conflict rules
    const employees = await this.prisma.employee.findMany({
      where: {
        id: { in: targetWorkerIds },
        organizationId: orgId,
      },
    });

    const evaluatedResults: Array<{
      employeeId: string;
      employeeCode: string;
      employeeName: string;
      status: BulkResultStatus;
      reasonCode: string | null;
      safeMessage: string | null;
    }> = [];

    let readyCount = 0;
    let conflictCount = 0;
    let inactiveCount = 0;

    const farFuture = new Date('2099-12-31');

    for (const empId of targetWorkerIds) {
      const emp = employees.find((e) => e.id === empId);

      if (!emp || emp.status !== 'ACTIVE') {
        inactiveCount++;
        evaluatedResults.push({
          employeeId: empId,
          employeeCode: emp?.employeeCode ?? 'UNKNOWN',
          employeeName: emp?.fullName ?? 'Inactive Worker',
          status: BulkResultStatus.SKIPPED_INACTIVE,
          reasonCode: 'EMPLOYEE_INACTIVE',
          safeMessage: 'Employee is not active in organization',
        });
        continue;
      }

      // Conflict Check (Amendment 7): Query active overlapping assignments
      const overlappingAssignments = await this.prisma.assignment.findMany({
        where: {
          organizationId: orgId,
          employeeId: emp.id,
          status: 'ACTIVE',
          startsOn: { lte: endsOnDate ?? farFuture },
          OR: [
            { endsOn: null },
            { endsOn: { gte: startsOnDate } },
          ],
        },
        include: {
          attendance: true,
        },
      });

      if (overlappingAssignments.length > 0) {
        // Amendment 7: Check if any overlapping assignment has attendance facts
        const hasAttendance = overlappingAssignments.some((a) => a.attendance.length > 0);

        if (hasAttendance) {
          // Rule: Never alter an assignment with attendance facts
          conflictCount++;
          evaluatedResults.push({
            employeeId: emp.id,
            employeeCode: emp.employeeCode,
            employeeName: emp.fullName,
            status: BulkResultStatus.SKIPPED_CONFLICT,
            reasonCode: 'ASSIGNMENT_HAS_ATTENDANCE_FACTS',
            safeMessage: 'Active assignment has recorded attendance facts and cannot be altered',
          });
        } else if (input.transferOption === true) {
          // Rule: If manager selected transferOption and no attendance facts exist, end prior assignment on prior day
          readyCount++;
          evaluatedResults.push({
            employeeId: emp.id,
            employeeCode: emp.employeeCode,
            employeeName: emp.fullName,
            status: BulkResultStatus.CREATED,
            reasonCode: 'TRANSFER_ELIGIBLE',
            safeMessage: 'Previous assignment without attendance will be ended on prior day',
          });
        } else {
          conflictCount++;
          evaluatedResults.push({
            employeeId: emp.id,
            employeeCode: emp.employeeCode,
            employeeName: emp.fullName,
            status: BulkResultStatus.SKIPPED_CONFLICT,
            reasonCode: 'OVERLAPPING_ACTIVE_ASSIGNMENT',
            safeMessage: 'Worker has active overlapping assignment for date range',
          });
        }
      } else {
        readyCount++;
        evaluatedResults.push({
          employeeId: emp.id,
          employeeCode: emp.employeeCode,
          employeeName: emp.fullName,
          status: BulkResultStatus.CREATED,
          reasonCode: 'READY',
          safeMessage: 'Ready for assignment',
        });
      }
    }

    // 4. Save Preview Batch & Results in database
    const batch = await this.prisma.$transaction(async (tx) => {
      const createdBatch = await tx.bulkAssignmentBatch.create({
        data: {
          organizationId: orgId,
          targetSiteId: input.siteId,
          scheduleId: input.scheduleId,
          startsOn: startsOnDate,
          endsOn: endsOnDate,
          requestedByUserId: actorUserId,
          previewId,
          previewExpiresAt,
          snapshotWorkerIds: targetWorkerIds,
          transferOption: input.transferOption ?? false,
          status: BulkBatchStatus.PREVIEW_GENERATED,
        },
      });

      await tx.bulkAssignmentResult.createMany({
        data: evaluatedResults.map((r) => ({
          batchId: createdBatch.id,
          employeeId: r.employeeId,
          status: r.status,
          reasonCode: r.reasonCode,
          safeMessage: r.safeMessage,
        })),
      });

      return createdBatch;
    });

    return {
      previewId: batch.previewId,
      previewExpiresAt: batch.previewExpiresAt.toISOString(),
      siteName: site.name,
      scheduleName: schedule.name,
      startsOn: input.startsOn,
      endsOn: input.endsOn ?? null,
      transferOption: input.transferOption ?? false,
      summary: {
        totalTargetWorkers: targetWorkerIds.length,
        readyCount,
        conflictCount,
        inactiveCount,
      },
      results: evaluatedResults.map((r) => ({
        id: r.employeeId,
        employeeId: r.employeeId,
        employeeCode: r.employeeCode,
        employeeName: r.employeeName,
        status: r.status,
        reasonCode: r.reasonCode,
        safeMessage: r.safeMessage,
        assignmentId: null,
      })),
    };
  }

  async applyAssignments(
    orgId: string,
    input: BulkAssignmentApplyInput,
    actorUserId: string,
  ) {
    // 1. Idempotency Check: check if already applied with this idempotency key
    const existingIdempotentBatch = await this.prisma.bulkAssignmentBatch.findUnique({
      where: {
        organizationId_requestedByUserId_idempotencyKey: {
          organizationId: orgId,
          requestedByUserId: actorUserId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      include: {
        results: true,
      },
    });

    if (existingIdempotentBatch && existingIdempotentBatch.status === BulkBatchStatus.COMPLETED) {
      const createdResults = existingIdempotentBatch.results.filter((r) => r.status === BulkResultStatus.CREATED);
      return {
        batchId: existingIdempotentBatch.id,
        status: 'COMPLETED',
        totalProcessed: existingIdempotentBatch.results.length,
        createdCount: createdResults.length,
        skippedCount: existingIdempotentBatch.results.length - createdResults.length,
        message: 'Bulk assignment batch already completed (idempotent response)',
      };
    }

    // 2. Retrieve preview snapshot batch
    const batch = await this.prisma.bulkAssignmentBatch.findFirst({
      where: {
        previewId: input.previewId,
        organizationId: orgId,
      },
      include: {
        results: {
          include: {
            employee: true,
          },
        },
      },
    });

    if (!batch) {
      throw new NotFoundException(`Preview snapshot '${input.previewId}' not found`);
    }

    if (batch.status === BulkBatchStatus.COMPLETED) {
      const createdResults = batch.results.filter((r) => r.status === BulkResultStatus.CREATED);
      return {
        batchId: batch.id,
        status: 'COMPLETED',
        totalProcessed: batch.results.length,
        createdCount: createdResults.length,
        skippedCount: batch.results.length - createdResults.length,
        message: 'Bulk assignment batch already completed',
      };
    }

    // Amendment 6 Token Expiry Guard
    if (batch.previewExpiresAt < new Date()) {
      throw new BadRequestException('PREVIEW_EXPIRED');
    }

    // 3. Mark batch as PROCESSING & bind idempotency key
    await this.prisma.bulkAssignmentBatch.update({
      where: { id: batch.id },
      data: {
        idempotencyKey: input.idempotencyKey,
        status: BulkBatchStatus.PROCESSING,
      },
    });

    const readyResults = batch.results.filter((r) => r.status === BulkResultStatus.CREATED);

    // Scale Architecture Amendment 8: Chunked transactions (100 workers per chunk)
    const chunkSize = 100;
    const priorEndDay = new Date(batch.startsOn.getTime() - 86400000);
    const farFuture = new Date('2099-12-31');

    let createdCount = 0;

    for (let i = 0; i < readyResults.length; i += chunkSize) {
      const chunk = readyResults.slice(i, i + chunkSize);

      await this.prisma.$transaction(async (tx) => {
        for (const item of chunk) {
          // If transferOption is true, close previous eligible active assignment without attendance
          if (batch.transferOption) {
            const priorAssignments = await tx.assignment.findMany({
              where: {
                organizationId: orgId,
                employeeId: item.employeeId,
                status: 'ACTIVE',
                startsOn: { lte: batch.endsOn ?? farFuture },
                OR: [
                  { endsOn: null },
                  { endsOn: { gte: batch.startsOn } },
                ],
              },
              include: { attendance: true },
            });

            for (const prior of priorAssignments) {
              if (prior.attendance.length === 0) {
                await tx.assignment.update({
                  where: { id: prior.id },
                  data: { endsOn: priorEndDay },
                });
              }
            }
          }

          // Create individual dated Assignment record
          const assignment = await tx.assignment.create({
            data: {
              organizationId: orgId,
              employeeId: item.employeeId,
              siteId: batch.targetSiteId,
              scheduleId: batch.scheduleId,
              startsOn: batch.startsOn,
              endsOn: batch.endsOn,
              status: 'ACTIVE',
            },
          });

          // Link created assignmentId to result record
          await tx.bulkAssignmentResult.update({
            where: { id: item.id },
            data: { assignmentId: assignment.id },
          });

          createdCount++;
        }
      });
    }

    // 4. Mark batch COMPLETED and log Audit
    await this.prisma.$transaction(async (tx) => {
      await tx.bulkAssignmentBatch.update({
        where: { id: batch.id },
        data: { status: BulkBatchStatus.COMPLETED },
      });

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId,
          action: 'BULK_ASSIGNMENT_APPLIED',
          targetType: 'BulkAssignmentBatch',
          targetId: batch.id,
          metadata: {
            previewId: batch.previewId,
            idempotencyKey: input.idempotencyKey,
            totalProcessed: batch.results.length,
            createdCount,
            skippedCount: batch.results.length - createdCount,
          },
        },
      });
    });

    return {
      batchId: batch.id,
      status: 'COMPLETED',
      totalProcessed: batch.results.length,
      createdCount,
      skippedCount: batch.results.length - createdCount,
      message: `Successfully created ${createdCount} individual site assignments`,
    };
  }
}
