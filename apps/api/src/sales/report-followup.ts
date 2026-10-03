import { z } from 'zod';
import type { Prisma } from '@prisma/client';

// Internal SALES_REPORT payload. Never pass this envelope to Telegram.
export const SALES_FOLLOWUP_PREFIX = 'workforce:sales-report:v1:';
const followupSchema = z.object({
  employeeId: z.string().min(1),
  telegramUserId: z.string().min(1),
  reportId: z.string().min(1).optional(),
}).strict();
export type SalesReportFollowup = z.infer<typeof followupSchema>;
export type SalesReportFollowupInput = Pick<SalesReportFollowup, 'employeeId' | 'telegramUserId'> & {
  organizationId: string;
  attendanceRecordId: string;
};

export function encodeSalesReportFollowup(task: SalesReportFollowup): string {
  return SALES_FOLLOWUP_PREFIX + JSON.stringify(followupSchema.parse(task));
}

export function decodeSalesReportFollowup(text: string): SalesReportFollowup | null {
  if (!text.startsWith(SALES_FOLLOWUP_PREFIX)) return null;
  return followupSchema.parse(JSON.parse(text.slice(SALES_FOLLOWUP_PREFIX.length)));
}

/** Call inside the authorized SALES checkout transaction, alongside its TEXT upsert. */
export async function enqueueSalesReportFollowup(tx: Prisma.TransactionClient, input: SalesReportFollowupInput) {
  if (!input.organizationId) throw new Error('SALES_FOLLOWUP_SCOPE_REQUIRED');
  const text = encodeSalesReportFollowup({
    employeeId: input.employeeId,
    telegramUserId: input.telegramUserId,
  });
  const delivery = await tx.telegramDelivery.upsert({
    where: {
      attendanceRecordId_kind: { attendanceRecordId: input.attendanceRecordId, kind: 'SALES_REPORT' },
      organizationId: input.organizationId,
    },
    create: {
      organizationId: input.organizationId,
      attendanceRecordId: input.attendanceRecordId,
      kind: 'SALES_REPORT',
      chatId: input.telegramUserId,
      text,
    },
    update: {},
  });
  if (!decodeSalesReportFollowup(delivery.text)) throw new Error('SALES_FOLLOWUP_PAYLOAD_INVALID');
  return delivery;
}

/** Replayable database-only preparation; no SalesModule -> JobsModule cycle or live membership call. */
export async function prepareSalesReportFollowup(
  tx: Prisma.TransactionClient,
  organizationId: string,
  attendanceRecordId: string,
  task: SalesReportFollowup,
) {
  const attendance = await tx.attendanceRecord.findFirst({
    where: {
      id: attendanceRecordId,
      organizationId,
      employeeId: task.employeeId,
      checkOutAt: { not: null },
      project: { organizationId, workMode: 'SALES' },
    },
    select: { id: true, projectId: true, attendanceDate: true },
  });
  if (!attendance) throw new Error('SALES_FOLLOWUP_ATTENDANCE_SCOPE_INVALID');
  const report = await tx.dailySalesReport.upsert({
    where: { attendanceRecordId, organizationId, employeeId: task.employeeId },
    create: {
      organizationId,
      employeeId: task.employeeId,
      projectId: attendance.projectId,
      attendanceRecordId,
      reportDate: attendance.attendanceDate,
    },
    update: {},
    select: { id: true },
  });
  const visits = await tx.visitLog.findMany({
    where: { organizationId, employeeId: task.employeeId, projectId: attendance.projectId, attendanceRecordId },
    select: { id: true },
  });
  if (visits.length) {
    await tx.dailySalesReportVisit.createMany({
      data: visits.map((visit) => ({ reportId: report.id, visitLogId: visit.id })),
      skipDuplicates: true,
    });
  }
  return report;
}
