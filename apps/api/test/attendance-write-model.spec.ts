import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { Prisma, type PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAttendanceWriteStatement,
  writeAttendance,
  type AttendanceCheckInWriteInput,
  type AttendanceCheckOutWriteInput,
  type AttendanceWriteInput,
} from '../src/attendance/attendance-write-model.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const checkInTime = new Date('2026-10-01T17:05:00.123Z'); // Oct 2 in Phnom Penh.
const checkOutTime = new Date('2026-10-02T09:00:00.456Z');

function checkIn(overrides: Partial<AttendanceCheckInWriteInput> = {}): AttendanceCheckInWriteInput {
  return {
    action: 'CHECK_IN', organizationId: 'org-a', employeeId: 'employee-a', projectId: 'project-a',
    assignmentId: 'assignment-a', siteId: 'site-a', attendanceDate: new Date('2026-10-02T00:00:00Z'),
    existingRecordId: null, telegramChatId: '-100-a', checkInPhotoPath: 'org-a/employee-a/proof.jpg',
    now: checkInTime, location: { latitude: 11.556412, longitude: 104.928234, accuracyMeters: 8.25 },
    idempotencyKey: 'check-in-key', distance: 12.3456, verification: 'VERIFIED', status: 'ON_TIME',
    deliveries: [{ kind: 'PHOTO', chatId: '-100-a', text: "Dara's check-in ✓", storagePath: 'org-a/employee-a/proof.jpg' }],
    ...overrides,
  };
}

function checkOut(recordId: string, overrides: Partial<AttendanceCheckOutWriteInput> = {}): AttendanceCheckOutWriteInput {
  return {
    action: 'CHECK_OUT', organizationId: 'org-a', employeeId: 'employee-a', projectId: 'project-a',
    recordId, now: checkOutTime, location: { latitude: 11.556499, longitude: 104.928299, accuracyMeters: 6.75 },
    idempotencyKey: 'check-out-key', distance: 15.678, verification: 'VERIFIED', status: 'COMPLETED',
    workDurationMinutes: 955,
    deliveries: [{ kind: 'TEXT', chatId: '-100-a', text: 'Check-out confirmed' }],
    ...overrides,
  };
}

// Real PostgreSQL types, constraints, indexes and foreign keys, regenerated from
// the actual Prisma schema. No DATABASE_URL is used to connect to any database.
describe('atomic attendance write model (isolated PostgreSQL / PGlite)', () => {
  let db: PGlite;
  const queryRaw = vi.fn(async (statement: Prisma.Sql) => (await db.query(statement.text, statement.values)).rows);
  const prisma = { $queryRaw: queryRaw } as unknown as Pick<PrismaClient, '$queryRaw'>;
  const execute = (input: AttendanceWriteInput) => writeAttendance(prisma, input);
  const sql = async <T = Record<string, unknown>>(statement: Prisma.Sql) => (await db.query<T>(statement.text, statement.values)).rows;

  async function snapshot() {
    return (await sql(Prisma.sql`
      SELECT
        (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id), '[]') FROM "AttendanceRecord" r) AS records,
        (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id), '[]') FROM "AttendanceEvent" e) AS events,
        (SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY id), '[]') FROM "AttendanceRequest" q) AS requests,
        (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id), '[]') FROM "AuditLog" a) AS audits,
        (SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY id), '[]') FROM "TelegramDelivery" d) AS deliveries,
        (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id), '[]') FROM "AttendanceCorrection" c) AS corrections
    `))[0] as Record<string, Record<string, unknown>[]>;
  }

  async function seedAbsent() {
    await sql(Prisma.sql`
      INSERT INTO "AttendanceRecord" (
        id, "organizationId", "employeeId", "assignmentId", "projectId", "siteId", "attendanceDate",
        "telegramChatId", status, "adjustedStatus", "adjustedCheckInAt", "adjustedProjectId", "createdAt", "updatedAt"
      ) VALUES ('absent-a', 'org-a', 'employee-a', 'assignment-a', 'project-a', 'site-a', '2026-10-02',
        '-100-historical', 'ABSENT', 'APPROVED_LEAVE', '2026-10-02 01:00:00', 'project-a2', '2026-10-01 10:00:00', '2026-10-01 10:00:00')
    `);
    await db.exec(`
      INSERT INTO "AttendanceEvent" (id, "organizationId", "attendanceRecordId", type, metadata)
        VALUES ('historical-event', 'org-a', 'absent-a', 'MANUAL_CORRECTION', '{"reason":"original review"}');
      INSERT INTO "AuditLog" (id, "organizationId", action, "targetType", "targetId", metadata)
        VALUES ('historical-audit', 'org-a', 'ABSENCE_REVIEWED', 'AttendanceRecord', 'absent-a', '{"reason":"original review"}');
      INSERT INTO "AttendanceCorrection" (id, "organizationId", "attendanceRecordId", reason, "correctedStatus")
        VALUES ('historical-correction', 'org-a', 'absent-a', 'Approved leave', 'APPROVED_LEAVE');
    `);
  }

  beforeAll(async () => {
    const schema = execFileSync(process.execPath, [
      require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-empty',
      '--to-schema-datamodel', 'prisma/schema.prisma', '--script',
    ], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/isolated_schema_only',
        DIRECT_URL: 'postgresql://unused:unused@127.0.0.1:1/isolated_schema_only',
      },
    });
    // Prisma reads timestamp-without-time-zone as UTC. PGlite's default parser
    // uses the host timezone; override that driver mapping to match production.
    db = new PGlite({ parsers: { 1114: (value: string) => new Date(`${value}Z`) } });
    await db.exec(schema);
  }, 60_000);

  afterAll(async () => { await db?.close(); });

  beforeEach(async () => {
    queryRaw.mockClear();
    await db.exec(`
      SET TIME ZONE 'UTC';
      TRUNCATE "Organization" CASCADE;
      INSERT INTO "Organization" (id, slug, name, "updatedAt") VALUES
        ('org-a', 'org-a', 'Organization A', NOW()), ('org-b', 'org-b', 'Organization B', NOW());
      INSERT INTO "Project" (id, "organizationId", code, name, status, "updatedAt") VALUES
        ('project-a', 'org-a', 'A', 'Project A', 'ACTIVE', NOW()),
        ('project-a2', 'org-a', 'A2', 'Project A2', 'ACTIVE', NOW()),
        ('project-b', 'org-b', 'B', 'Project B', 'ACTIVE', NOW());
      INSERT INTO "Employee" (id, "organizationId", "employeeCode", "fullName") VALUES
        ('employee-a', 'org-a', 'A', 'Dara'), ('employee-a2', 'org-a', 'A2', 'Sok'),
        ('employee-b', 'org-b', 'B', 'Worker B');
      INSERT INTO "Site" (id, "organizationId", "projectId", name, latitude, longitude, "allowedRadiusMeters", timezone) VALUES
        ('site-a', 'org-a', 'project-a', 'Site A', 11.55, 104.92, 100, 'Asia/Phnom_Penh'),
        ('site-a2', 'org-a', 'project-a2', 'Site A2', 11.55, 104.92, 100, 'Asia/Phnom_Penh'),
        ('site-b', 'org-b', 'project-b', 'Site B', 11.55, 104.92, 100, 'Asia/Phnom_Penh');
      INSERT INTO "WorkSchedule" (id, "organizationId", name, timezone, "startTime", "endTime") VALUES
        ('schedule-a', 'org-a', 'Day', 'Asia/Phnom_Penh', '08:00', '17:00'),
        ('schedule-b', 'org-b', 'Day', 'Asia/Phnom_Penh', '08:00', '17:00');
      INSERT INTO "Assignment" (id, "organizationId", "employeeId", "siteId", "scheduleId", "startsOn", "endsOn") VALUES
        ('assignment-a', 'org-a', 'employee-a', 'site-a', 'schedule-a', '2026-01-01', '2026-12-31'),
        ('assignment-a-extra', 'org-a', 'employee-a', 'site-a', 'schedule-a', '2026-01-01', '2026-12-31'),
        ('assignment-a2', 'org-a', 'employee-a2', 'site-a', 'schedule-a', '2026-01-01', NULL),
        ('assignment-b', 'org-b', 'employee-b', 'site-b', 'schedule-b', '2026-01-01', NULL);
    `);
  });

  it('binds all values and atomically creates the record, event, request, audit and photo intent in one call', async () => {
    const key = "key'); DROP TABLE \"Employee\"; --";
    const statement = buildAttendanceWriteStatement(checkIn({ idempotencyKey: key }));
    expect(statement.text).not.toContain(key);
    expect(statement.values).toContain(key);
    const result = await execute(checkIn({ idempotencyKey: key }));
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(result?.record).toMatchObject({
      organizationId: 'org-a', employeeId: 'employee-a', projectId: 'project-a', assignmentId: 'assignment-a', siteId: 'site-a',
      status: 'ON_TIME', checkInStatus: 'ON_TIME', checkInVerification: 'VERIFIED', checkInAt: checkInTime,
      checkOutAt: null, checkInPhotoPath: 'org-a/employee-a/proof.jpg', telegramChatId: '-100-a',
      workDurationMinutes: null, createdAt: checkInTime, updatedAt: checkInTime,
    });
    expect(result?.record.id).toMatch(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/);
    expect(Number(result?.record.checkInLatitude)).toBe(11.556412);
    expect(Number(result?.record.checkInLongitude)).toBe(104.928234);
    expect(Number(result?.record.checkInAccuracyMeters)).toBe(8.25);
    expect(Number(result?.record.checkInDistanceMeters)).toBe(12.35);
    const saved = await snapshot();
    expect(saved.records).toHaveLength(1);
    expect(saved.events).toMatchObject([{ organizationId: 'org-a', attendanceRecordId: result!.record.id, type: 'CHECK_IN_SUCCESS', metadata: { distanceMeters: 12.35, accuracyMeters: 8.25, idempotencyKey: key } }]);
    expect(saved.requests).toMatchObject([{ organizationId: 'org-a', employeeId: 'employee-a', action: 'CHECK_IN', idempotencyKey: key, attendanceRecordId: result!.record.id }]);
    expect(saved.audits).toMatchObject([{ action: 'ATTENDANCE_CHECK_IN', targetType: 'AttendanceRecord', targetId: result!.record.id, metadata: { employeeId: 'employee-a', status: 'ON_TIME', verification: 'VERIFIED' } }]);
    expect(saved.deliveries).toMatchObject([{ kind: 'PHOTO', chatId: '-100-a', text: "Dara's check-in ✓", status: 'PENDING', attempts: 0 }]);
    expect(result!.deliveryIds).toEqual([saved.deliveries[0]!.id]);
  });

  it('preserves site-local date and official UTC milliseconds with a non-UTC database session', async () => {
    await db.exec("SET TIME ZONE 'Pacific/Honolulu'");
    const result = await execute(checkIn());
    expect(result!.record.checkInAt).toEqual(checkInTime);
    const [row] = await sql(Prisma.sql`SELECT "attendanceDate"::text AS date, "checkInAt"::text AS time FROM "AttendanceRecord"`);
    expect(row).toEqual({ date: '2026-10-02', time: '2026-10-01 17:05:00.123' });
  });

  it.each([
    ['VERIFIED', 'LATE', 'CHECK_IN_SUCCESS'],
    ['OUTSIDE_GEOFENCE', 'OUTSIDE_GEOFENCE', 'CHECK_IN_OUTSIDE_GEOFENCE'],
    ['LOW_ACCURACY', 'LOW_ACCURACY', 'CHECK_IN_LOW_ACCURACY'],
  ] as const)('persists computed %s check-in verification, phase status and event type', async (verification, status, eventType) => {
    const result = await execute(checkIn({ verification, status, deliveries: undefined }));
    expect(result).toMatchObject({ record: { status, checkInStatus: status, checkInVerification: verification }, deliveryIds: [] });
    expect((await snapshot()).events).toMatchObject([{ type: eventType }]);
  });

  it('checks out once, appends history and a text intent, and preserves original check-in evidence', async () => {
    const start = (await execute(checkIn({ status: 'LATE' })))!;
    const before = await snapshot();
    queryRaw.mockClear();
    const end = (await execute(checkOut(start.record.id)))!;
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(end.record).toMatchObject({
      id: start.record.id, status: 'COMPLETED', checkInStatus: 'LATE', checkOutStatus: 'COMPLETED',
      checkInAt: checkInTime, checkOutAt: checkOutTime, checkOutVerification: 'VERIFIED',
      workDurationMinutes: 955, createdAt: checkInTime, updatedAt: checkOutTime,
    });
    expect(Number(end.record.checkOutDistanceMeters)).toBe(15.68);
    const after = await snapshot();
    for (const field of ['events', 'requests', 'audits', 'deliveries']) {
      expect(after[field]).toEqual(expect.arrayContaining(before[field]!));
      expect(after[field]).toHaveLength(2);
    }
    for (const [key, value] of Object.entries(before.records[0]!)) {
      if (key.startsWith('checkIn') || ['createdAt', 'attendanceDate', 'telegramChatId'].includes(key)) {
        expect(after.records[0]![key]).toEqual(value);
      }
    }
    expect(after.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'CHECK_OUT_SUCCESS', metadata: { distanceMeters: 15.68, accuracyMeters: 6.75, workDurationMinutes: 955, idempotencyKey: 'check-out-key' } })]));
    expect(after.audits).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'ATTENDANCE_CHECK_OUT', metadata: { employeeId: 'employee-a', status: 'COMPLETED', workDurationMinutes: 955 } })]));
    const textIntent = after.deliveries.find((row) => row.kind === 'TEXT')!;
    expect(textIntent).toMatchObject({ storagePath: null, text: 'Check-out confirmed', status: 'PENDING' });
    expect(end.deliveryIds).toEqual([textIntent.id]);
  });

  it.each(['OUTSIDE_GEOFENCE', 'LOW_ACCURACY'] as const)('retains checkout %s semantics without rewriting check-in status', async (verification) => {
    const start = (await execute(checkIn()))!;
    const end = await execute(checkOut(start.record.id, { status: verification, verification, deliveries: [] }));
    expect(end).toMatchObject({ record: { status: verification, checkInStatus: 'ON_TIME', checkOutStatus: verification, checkOutVerification: verification }, deliveryIds: [] });
    expect((await snapshot()).events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'CHECK_OUT_SUCCESS' })]));
  });

  it('returns null for a missing, absent, or already-closed checkout and writes no side effects', async () => {
    const empty = await snapshot();
    expect(await execute(checkOut('missing'))).toBeNull();
    expect(await snapshot()).toEqual(empty);
    await seedAbsent();
    const absent = await snapshot();
    expect(await execute(checkOut('absent-a'))).toBeNull();
    expect(await snapshot()).toEqual(absent);
    const start = (await execute(checkIn({ existingRecordId: 'absent-a' })))!;
    await execute(checkOut(start.record.id));
    const closed = await snapshot();
    expect(await execute(checkOut(start.record.id, { idempotencyKey: 'another-checkout', now: new Date('2026-10-03T09:00:00Z'), workDurationMinutes: 9999 }))).toBeNull();
    expect(await snapshot()).toEqual(closed);
  });

  it('converts an absent row exactly once without changing its identity, ownership, corrections or earlier history', async () => {
    await seedAbsent();
    const before = await snapshot();
    const result = await execute(checkIn({ existingRecordId: 'absent-a' }));
    expect(result!.record).toMatchObject({ id: 'absent-a', checkInAt: checkInTime, status: 'ON_TIME', telegramChatId: '-100-historical', adjustedStatus: 'APPROVED_LEAVE', adjustedProjectId: 'project-a2', createdAt: new Date('2026-10-01T10:00:00Z') });
    const after = await snapshot();
    expect(after.records).toHaveLength(1);
    expect(after.corrections).toEqual(before.corrections);
    expect(after.events).toEqual(expect.arrayContaining(before.events!));
    expect(after.audits).toEqual(expect.arrayContaining(before.audits!));
    expect(after.records[0]!.adjustedCheckInAt).toEqual(before.records[0]!.adjustedCheckInAt);
    expect(await execute(checkIn({ existingRecordId: 'absent-a', idempotencyKey: 'loser', status: 'LATE' }))).toBeNull();
    expect(await snapshot()).toEqual(after);
  });

  it('does not silently insert when a pre-read absent ID is missing or belongs to a different day', async () => {
    expect(await execute(checkIn({ existingRecordId: 'missing' }))).toBeNull();
    await seedAbsent();
    const before = await snapshot();
    expect(await execute(checkIn({ existingRecordId: 'absent-a', attendanceDate: new Date('2026-10-03T00:00:00Z') }))).toBeNull();
    expect(await snapshot()).toEqual(before);
  });

  it('preserves the legacy assignment fallback to a different active project in the same tenant', async () => {
    const start = (await execute(checkIn({ projectId: 'project-a2', telegramChatId: '-100-a2' })))!;
    expect(start.record).toMatchObject({ projectId: 'project-a2', assignmentId: 'assignment-a', siteId: 'site-a' });
    const end = await execute(checkOut(start.record.id, { projectId: 'project-a2' }));
    expect(end!.record).toMatchObject({ projectId: 'project-a2', siteId: 'site-a', checkOutAt: checkOutTime });
  });

  it('preserves an absent legacy row whose record project differs from its assignment project', async () => {
    await seedAbsent();
    await db.exec(`UPDATE "AttendanceRecord" SET "projectId" = 'project-a2' WHERE id = 'absent-a'`);
    const start = await execute(checkIn({ existingRecordId: 'absent-a', projectId: 'project-a2' }));
    expect(start!.record).toMatchObject({ id: 'absent-a', projectId: 'project-a2', siteId: 'site-a', telegramChatId: '-100-historical' });
    expect(await execute(checkOut('absent-a', { projectId: 'project-a2' }))).not.toBeNull();
  });

  it.each([
    `UPDATE "Project" SET status = 'PAUSED' WHERE id = 'project-a'`,
    `UPDATE "Project" SET "organizationId" = 'org-b' WHERE id = 'project-a'`,
  ])('rejects a legacy fallback when the assignment project is inactive or outside the tenant: %s', async (change) => {
    await db.exec(change);
    expect(await execute(checkIn({ projectId: 'project-a2' }))).toBeNull();
    expect((await snapshot()).records).toEqual([]);
  });

  it('daily uniqueness prevents a new-key or same-key insert from overwriting the winner', async () => {
    const winner = (await execute(checkIn()))!;
    const before = await snapshot();
    for (const idempotencyKey of ['check-in-key', 'different-key']) {
      await expect(execute(checkIn({ idempotencyKey, status: 'LOW_ACCURACY', verification: 'LOW_ACCURACY' }))).rejects.toMatchObject({ code: '23505' });
      expect(await snapshot()).toEqual(before);
    }
    const [replay] = await sql(Prisma.sql`
      SELECT r.id FROM "AttendanceRequest" q
      JOIN "AttendanceRecord" r ON r.id = q."attendanceRecordId"
        AND r."organizationId" = q."organizationId" AND r."employeeId" = q."employeeId"
      WHERE q."organizationId" = 'org-a' AND q."employeeId" = 'employee-a'
        AND q.action = 'CHECK_IN' AND q."idempotencyKey" = 'check-in-key'
    `);
    expect(replay!.id).toBe(winner.record.id);
  });

  it('allows the next site-local day with a new request key', async () => {
    const first = (await execute(checkIn()))!;
    const second = (await execute(checkIn({ attendanceDate: new Date('2026-10-03T00:00:00Z'), idempotencyKey: 'next-day', now: new Date('2026-10-02T17:05:00Z') })))!;
    expect(second.record.id).not.toBe(first.record.id);
    expect((await snapshot()).records).toHaveLength(2);
  });

  it('rolls back every CTE if the request key already belongs to a different attendance record', async () => {
    await execute(checkIn());
    const before = await snapshot();
    await expect(execute(checkIn({ assignmentId: 'assignment-a-extra' }))).rejects.toMatchObject({ code: '23505' });
    expect(await snapshot()).toEqual(before);
  });

  it.each(['CHECK_IN', 'CHECK_OUT'] as const)('rolls back a claimed row and all side effects on a duplicate %s request', async (action) => {
    await seedAbsent();
    if (action === 'CHECK_OUT') await execute(checkIn({ existingRecordId: 'absent-a' }));
    await sql(Prisma.sql`
      INSERT INTO "AttendanceRequest" (id, "organizationId", "employeeId", action, "idempotencyKey", "attendanceRecordId")
      VALUES ('preexisting-request', 'org-a', 'employee-a', ${action}::"AttendanceAction", 'duplicate-key', 'absent-a')
    `);
    const before = await snapshot();
    const input = action === 'CHECK_IN'
      ? checkIn({ existingRecordId: 'absent-a', idempotencyKey: 'duplicate-key' })
      : checkOut('absent-a', { idempotencyKey: 'duplicate-key' });
    await expect(execute(input)).rejects.toMatchObject({ code: '23505' });
    expect(await snapshot()).toEqual(before);
  });

  it('rolls back the entire statement when a dependent outbox insert fails', async () => {
    await db.exec(`ALTER TABLE "TelegramDelivery" ADD CONSTRAINT isolated_delivery_failure CHECK (text <> 'force-failure')`);
    try {
      const before = await snapshot();
      await expect(execute(checkIn({ deliveries: [{ kind: 'PHOTO', chatId: '-100-a', text: 'force-failure' }] }))).rejects.toMatchObject({ code: '23514' });
      expect(await snapshot()).toEqual(before);
    } finally {
      await db.exec('ALTER TABLE "TelegramDelivery" DROP CONSTRAINT isolated_delivery_failure');
    }
  });

  it.each([
    { organizationId: 'org-b' }, { employeeId: 'employee-b' }, { employeeId: 'employee-a2' },
    { projectId: 'project-b' }, { siteId: 'site-b' },
    { assignmentId: 'assignment-b' }, { assignmentId: 'assignment-a2' },
  ])('denies mismatched check-in ownership %j with no child rows', async (overrides) => {
    const before = await snapshot();
    expect(await execute(checkIn(overrides))).toBeNull();
    expect(await snapshot()).toEqual(before);
    await seedAbsent();
    const absent = await snapshot();
    expect(await execute(checkIn({ ...overrides, existingRecordId: 'absent-a' }))).toBeNull();
    expect(await snapshot()).toEqual(absent);
  });

  it.each([
    { organizationId: 'org-b' }, { employeeId: 'employee-b' }, { employeeId: 'employee-a2' },
    { projectId: 'project-b' }, { projectId: 'project-a2' },
  ])('denies mismatched checkout ownership %j without touching the winner', async (overrides) => {
    const start = (await execute(checkIn()))!;
    const before = await snapshot();
    expect(await execute(checkOut(start.record.id, overrides))).toBeNull();
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    `UPDATE "Assignment" SET "organizationId" = 'org-b' WHERE id = 'assignment-a'`,
    `UPDATE "Site" SET "organizationId" = 'org-b' WHERE id = 'site-a'`,
    `UPDATE "WorkSchedule" SET "organizationId" = 'org-b' WHERE id = 'schedule-a'`,
    `UPDATE "Project" SET "organizationId" = 'org-b' WHERE id = 'project-a'`,
    `UPDATE "Employee" SET "organizationId" = 'org-b' WHERE id = 'employee-a'`,
  ])('revalidates ownership even with malformed cross-tenant foreign keys: %s', async (corrupt) => {
    const start = (await execute(checkIn()))!;
    await db.exec(corrupt);
    const before = await snapshot();
    expect(await execute(checkOut(start.record.id))).toBeNull();
    expect(await execute(checkIn({ attendanceDate: new Date('2026-10-03T00:00:00Z'), idempotencyKey: 'second-record' }))).toBeNull();
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    `UPDATE "Employee" SET status = 'INACTIVE' WHERE id = 'employee-a'`,
    `UPDATE "Project" SET status = 'PAUSED' WHERE id = 'project-a'`,
    `UPDATE "Site" SET status = 'INACTIVE' WHERE id = 'site-a'`,
    `UPDATE "Assignment" SET status = 'CANCELLED' WHERE id = 'assignment-a'`,
    `UPDATE "Assignment" SET "startsOn" = '2026-10-03' WHERE id = 'assignment-a'`,
    `UPDATE "Assignment" SET "endsOn" = '2026-10-01' WHERE id = 'assignment-a'`,
  ])('revalidates active, dated check-in eligibility: %s', async (change) => {
    await db.exec(change);
    expect(await execute(checkIn())).toBeNull();
    expect((await snapshot()).records).toEqual([]);
  });

  it('keeps identical keys isolated by employee, tenant and action', async () => {
    const a = (await execute(checkIn()))!;
    await execute(checkIn({ employeeId: 'employee-a2', assignmentId: 'assignment-a2' }));
    await execute(checkIn({ organizationId: 'org-b', employeeId: 'employee-b', projectId: 'project-b', siteId: 'site-b', assignmentId: 'assignment-b' }));
    await execute(checkOut(a.record.id, { idempotencyKey: 'check-in-key' }));
    expect((await snapshot()).requests).toHaveLength(4);
  });

  it('keeps one winner when two fresh check-ins are submitted together (PGlite serializes connections)', async () => {
    const results = await Promise.allSettled([
      execute(checkIn()), execute(checkIn({ idempotencyKey: 'competitor', status: 'LATE' })),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const saved = await snapshot();
    for (const field of ['records', 'events', 'requests', 'audits', 'deliveries']) expect(saved[field]).toHaveLength(1);
  });

  it('keeps one winner when two absent-row claims are submitted together', async () => {
    await seedAbsent();
    const results = await Promise.all([
      execute(checkIn({ existingRecordId: 'absent-a' })),
      execute(checkIn({ existingRecordId: 'absent-a', idempotencyKey: 'competitor', status: 'LATE' })),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((result) => result === null)).toHaveLength(1);
    expect((await snapshot()).requests).toHaveLength(1);
  });

  it('keeps one winner for competing checkouts with different timestamps, locations and duration', async () => {
    const start = (await execute(checkIn()))!;
    const first = (await execute(checkOut(start.record.id)))!;
    const before = await snapshot();
    expect(await execute(checkOut(start.record.id, {
      idempotencyKey: 'competitor', now: new Date('2026-10-02T10:00:00Z'), workDurationMinutes: 1015,
      location: { latitude: 12, longitude: 105, accuracyMeters: 99 }, status: 'LOW_ACCURACY', verification: 'LOW_ACCURACY',
    }))).toBeNull();
    expect(await snapshot()).toEqual(before);
    expect(first.record.checkOutAt).toEqual(checkOutTime);
    // A same-key retry is also a lost claim; the parent replays its scoped request.
    expect(await execute(checkOut(start.record.id))).toBeNull();
  });

  it('handles multiple optional intents and leaves existing delivery history immutable', async () => {
    const start = (await execute(checkIn()))!;
    const before = await snapshot();
    const end = (await execute(checkOut(start.record.id, { deliveries: [
      { kind: 'PHOTO', chatId: '-100-new', text: 'must not replace old caption', storagePath: 'new-path' },
      { kind: 'TEXT', chatId: '-100-a', text: 'new text' },
    ] })))!;
    const after = await snapshot();
    expect(after.deliveries).toHaveLength(2);
    expect(after.deliveries).toEqual(expect.arrayContaining(before.deliveries!));
    expect(end.deliveryIds.sort()).toEqual(after.deliveries.map((row) => row.id).sort());
  });

  it('atomically appends independent TEXT and SALES_REPORT intents for checkout', async () => {
    const start = (await execute(checkIn()))!;
    const payload = 'workforce:sales-report:v1:' + JSON.stringify({ employeeId: 'employee-a', telegramUserId: 'telegram-a' });
    const result = (await execute(checkOut(start.record.id, { deliveries: [
      { kind: 'TEXT', chatId: '-100-a', text: 'Group checkout text' },
      { kind: 'SALES_REPORT', chatId: 'telegram-a', text: payload },
    ] })))!;
    const saved = await snapshot();
    const checkoutDeliveries = saved.deliveries.filter((row) => row.kind !== 'PHOTO');
    expect(checkoutDeliveries).toHaveLength(2);
    expect(result.deliveryIds.sort()).toEqual(checkoutDeliveries.map((row) => row.id).sort());
    expect(checkoutDeliveries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'TEXT', chatId: '-100-a', text: 'Group checkout text' }),
      expect.objectContaining({ kind: 'SALES_REPORT', chatId: 'telegram-a', text: payload, storagePath: null, status: 'PENDING' }),
    ]));
  });

  it('exposes a parameterized statement usable by EXPLAIN without executing writes', async () => {
    const input = checkIn();
    const before = await snapshot();
    const plan = await sql(Prisma.sql`EXPLAIN (FORMAT JSON) ${buildAttendanceWriteStatement(input)}`);
    expect(plan).toHaveLength(1);
    expect(JSON.stringify(plan)).toContain('ModifyTable');
    expect(await snapshot()).toEqual(before);
  });
});
