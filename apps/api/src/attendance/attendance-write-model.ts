import { randomUUID } from 'node:crypto';
import { Prisma, type AttendanceRecord, type AttendanceStatus, type PrismaClient, type TelegramDeliveryKind, type VerificationStatus } from '@prisma/client';

export interface AttendanceDeliveryIntent {
  // Follows the generated enum, including future kinds once the schema is migrated.
  kind: TelegramDeliveryKind;
  chatId: string;
  text: string;
  storagePath?: string | null;
}

interface AttendanceWriteBase {
  organizationId: string;
  employeeId: string;
  projectId: string;
  idempotencyKey: string;
  /** Official API receipt time, never the client's capture time. */
  now: Date;
  location: { latitude: number; longitude: number; accuracyMeters: number };
  /** Distance, verification and status have already been calculated by the API. */
  distance: number;
  verification: VerificationStatus;
  status: AttendanceStatus;
  deliveries?: readonly AttendanceDeliveryIntent[];
}

export interface AttendanceCheckInWriteInput extends AttendanceWriteBase {
  action: 'CHECK_IN';
  assignmentId: string;
  siteId: string;
  /** Site-local calendar date represented as UTC midnight. */
  attendanceDate: Date;
  /** Claim this pre-created absent row; null means insert a new daily record. */
  existingRecordId: string | null;
  telegramChatId: string | null;
  checkInPhotoPath: string;
}

export interface AttendanceCheckOutWriteInput extends AttendanceWriteBase {
  action: 'CHECK_OUT';
  recordId: string;
  workDurationMinutes: number;
}

export type AttendanceWriteInput = AttendanceCheckInWriteInput | AttendanceCheckOutWriteInput;
export interface AttendanceWriteResult {
  record: AttendanceRecord;
  deliveryIds: string[];
}

/**
 * One atomic PostgreSQL statement. Authentication, policy evaluation, photo upload
 * and captions belong to the caller. SQL rechecks persisted ownership and claims
 * exactly one transition before appending its dependent history and outbox rows.
 *
 * A lost conditional claim returns no rows. Unique violations are deliberately
 * propagated (Prisma raw-query errors, usually P2010 / SQLSTATE 23505); callers
 * replay by organization + employee + action + idempotency key after either case.
 */
export function buildAttendanceWriteStatement(input: AttendanceWriteInput): Prisma.Sql {
  // Explicit UTC conversion avoids session-timezone changes to timestamp(3) columns.
  const now = Prisma.sql`(${input.now.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  const distance = Math.round(input.distance * 100) / 100;
  const scope = Prisma.sql`
    SELECT e.id
    FROM "Employee" e
    JOIN "Project" p ON p.id = ${input.projectId} AND p."organizationId" = e."organizationId"
    WHERE e.id = ${input.employeeId} AND e."organizationId" = ${input.organizationId}
    ${input.action === 'CHECK_IN' ? Prisma.sql`AND e.status = 'ACTIVE' AND p.status = 'ACTIVE'` : Prisma.empty}
  `;

  let mutation: Prisma.Sql;
  if (input.action === 'CHECK_IN') {
    const date = input.attendanceDate.toISOString().slice(0, 10);
    // Legacy single-assignment fallback can use a different project's site.
    // Validate both projects' tenant ownership without equating their IDs.
    const assignmentScope = Prisma.sql`
      SELECT a.id
      FROM "Assignment" a
      JOIN "Site" s ON s.id = a."siteId" AND s."organizationId" = a."organizationId"
      JOIN "Project" ap ON ap.id = s."projectId" AND ap."organizationId" = a."organizationId"
      JOIN "WorkSchedule" w ON w.id = a."scheduleId" AND w."organizationId" = a."organizationId"
      WHERE a.id = ${input.assignmentId} AND a."organizationId" = ${input.organizationId}
        AND a."employeeId" = ${input.employeeId} AND a."siteId" = ${input.siteId}
        AND ap.status = 'ACTIVE' AND s.status = 'ACTIVE' AND a.status = 'ACTIVE'
        AND a."startsOn" <= ${date}::date AND (a."endsOn" IS NULL OR a."endsOn" >= ${date}::date)
        AND EXISTS (${scope})
    `;
    mutation = input.existingRecordId !== null
      ? Prisma.sql`
        UPDATE "AttendanceRecord" r SET
          "checkInAt" = ${now}, "checkInLatitude" = ${input.location.latitude},
          "checkInLongitude" = ${input.location.longitude}, "checkInAccuracyMeters" = ${input.location.accuracyMeters},
          "checkInDistanceMeters" = ${distance}, "checkInVerification" = ${input.verification}::"VerificationStatus",
          "checkInPhotoPath" = ${input.checkInPhotoPath}, "checkInStatus" = ${input.status}::"AttendanceStatus",
          status = ${input.status}::"AttendanceStatus", "updatedAt" = ${now}
        WHERE r.id = ${input.existingRecordId} AND r."organizationId" = ${input.organizationId}
          AND r."employeeId" = ${input.employeeId} AND r."projectId" = ${input.projectId}
          AND r."assignmentId" = ${input.assignmentId} AND r."siteId" = ${input.siteId}
          AND r."attendanceDate" = ${date}::date AND r."checkInAt" IS NULL AND r."checkOutAt" IS NULL
          AND EXISTS (${assignmentScope})
        RETURNING r.*
      `
      : Prisma.sql`
        INSERT INTO "AttendanceRecord" (
          id, "organizationId", "employeeId", "assignmentId", "projectId", "siteId", "telegramChatId",
          "attendanceDate", "checkInAt", "checkInLatitude", "checkInLongitude", "checkInAccuracyMeters",
          "checkInDistanceMeters", "checkInVerification", "checkInPhotoPath", "checkInStatus", status, "createdAt", "updatedAt"
        ) SELECT ${randomUUID()}, ${input.organizationId}, ${input.employeeId}, ${input.assignmentId},
          ${input.projectId}, ${input.siteId}, ${input.telegramChatId}, ${date}::date, ${now},
          ${input.location.latitude}, ${input.location.longitude}, ${input.location.accuracyMeters},
          ${distance}, ${input.verification}::"VerificationStatus", ${input.checkInPhotoPath},
          ${input.status}::"AttendanceStatus", ${input.status}::"AttendanceStatus", ${now}, ${now}
        WHERE EXISTS (${assignmentScope})
        RETURNING *
      `;
  } else {
    mutation = Prisma.sql`
      UPDATE "AttendanceRecord" r SET
        "checkOutAt" = ${now}, "checkOutLatitude" = ${input.location.latitude},
        "checkOutLongitude" = ${input.location.longitude}, "checkOutAccuracyMeters" = ${input.location.accuracyMeters},
        "checkOutDistanceMeters" = ${distance}, "checkOutVerification" = ${input.verification}::"VerificationStatus",
        "checkOutStatus" = ${input.status}::"AttendanceStatus", status = ${input.status}::"AttendanceStatus",
        "workDurationMinutes" = ${input.workDurationMinutes}::integer, "updatedAt" = ${now}
      WHERE r.id = ${input.recordId} AND r."organizationId" = ${input.organizationId}
        AND r."employeeId" = ${input.employeeId} AND r."projectId" = ${input.projectId}
        AND r."checkInAt" IS NOT NULL AND r."checkOutAt" IS NULL
        AND EXISTS (${scope})
        AND EXISTS (
          SELECT a.id FROM "Assignment" a
          JOIN "Site" s ON s.id = a."siteId" AND s."organizationId" = a."organizationId"
          JOIN "Project" ap ON ap.id = s."projectId" AND ap."organizationId" = a."organizationId"
          JOIN "WorkSchedule" w ON w.id = a."scheduleId" AND w."organizationId" = a."organizationId"
          WHERE a.id = r."assignmentId" AND a."organizationId" = r."organizationId"
            AND a."employeeId" = r."employeeId" AND a."siteId" = r."siteId"
        )
      RETURNING r.*
    `;
  }

  const eventType = input.action === 'CHECK_OUT' ? 'CHECK_OUT_SUCCESS'
    : input.verification === 'OUTSIDE_GEOFENCE' ? 'CHECK_IN_OUTSIDE_GEOFENCE'
      : input.verification === 'LOW_ACCURACY' ? 'CHECK_IN_LOW_ACCURACY' : 'CHECK_IN_SUCCESS';
  const eventMetadata = {
    distanceMeters: distance,
    accuracyMeters: input.location.accuracyMeters,
    idempotencyKey: input.idempotencyKey,
    ...(input.action === 'CHECK_OUT' ? { workDurationMinutes: input.workDurationMinutes } : {}),
  };
  const auditMetadata = {
    employeeId: input.employeeId,
    status: input.status,
    ...(input.action === 'CHECK_IN' ? { verification: input.verification } : { workDurationMinutes: input.workDurationMinutes }),
  };
  const deliveries = (input.deliveries ?? []).map((intent) => ({ ...intent, id: randomUUID() }));

  return Prisma.sql`
    WITH changed AS (${mutation}),
    event_write AS (
      INSERT INTO "AttendanceEvent" (id, "organizationId", "attendanceRecordId", type, "occurredAt", metadata)
      SELECT ${randomUUID()}, r."organizationId", r.id, ${eventType}::"AttendanceEventType", ${now}, ${JSON.stringify(eventMetadata)}::jsonb
      FROM changed r RETURNING id
    ),
    request_write AS (
      INSERT INTO "AttendanceRequest" (id, "organizationId", "employeeId", action, "idempotencyKey", "attendanceRecordId", "createdAt")
      SELECT ${randomUUID()}, r."organizationId", r."employeeId", ${input.action}::"AttendanceAction", ${input.idempotencyKey}, r.id, ${now}
      FROM changed r RETURNING id
    ),
    audit_write AS (
      INSERT INTO "AuditLog" (id, "organizationId", action, "targetType", "targetId", metadata, "occurredAt")
      SELECT ${randomUUID()}, r."organizationId", ${`ATTENDANCE_${input.action}`}, 'AttendanceRecord', r.id, ${JSON.stringify(auditMetadata)}::jsonb, ${now}
      FROM changed r RETURNING id
    ),
    delivery_input AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(deliveries)}::jsonb)
        AS d(id text, kind text, "chatId" text, text text, "storagePath" text)
    ),
    delivery_write AS (
      INSERT INTO "TelegramDelivery" (id, "organizationId", "attendanceRecordId", kind, "chatId", text, "storagePath", "createdAt", "updatedAt", "nextAttemptAt")
      SELECT d.id, r."organizationId", r.id, d.kind::"TelegramDeliveryKind", d."chatId", d.text, d."storagePath", ${now}, ${now}, ${now}
      FROM changed r CROSS JOIN delivery_input d
      ON CONFLICT ("attendanceRecordId", kind) DO NOTHING
      RETURNING id
    )
    SELECT r.*, ARRAY(
      SELECT id FROM delivery_write
      UNION
      SELECT d.id FROM "TelegramDelivery" d
      WHERE d."organizationId" = r."organizationId" AND d."attendanceRecordId" = r.id
        AND d.kind::text IN (SELECT kind FROM delivery_input)
    ) AS "deliveryIds"
    FROM changed r
  `;
}

export async function writeAttendance(
  prisma: Pick<PrismaClient, '$queryRaw'>,
  input: AttendanceWriteInput,
): Promise<AttendanceWriteResult | null> {
  const [row] = await prisma.$queryRaw<(AttendanceRecord & { deliveryIds: string[] })[]>(buildAttendanceWriteStatement(input));
  if (!row) return null;
  const { deliveryIds, ...record } = row;
  return { record, deliveryIds };
}
