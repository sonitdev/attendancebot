// Run: node scripts/performance-readonly.mjs [--samples=25] [--self-test]
// Output is sanitized JSONL to stdout; this script never writes files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'apps/api/package.json'));
const ts = require('typescript');
const { PrismaClient, Prisma } = require('@prisma/client');
const { parse } = createRequire(require.resolve('@nestjs/config'))('dotenv');
const emit = (label, value) => console.log(JSON.stringify({ label, ...value }));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const round = (value) => Number(value.toFixed(3));
const summary = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { n: sorted.length, medianMs: round(sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2),
    p95Ms: round(sorted[Math.ceil(sorted.length * 0.95) - 1]), minMs: round(sorted[0]), maxMs: round(sorted.at(-1)) };
};
const numericKeys = new Set(['Startup Cost', 'Total Cost', 'Plan Rows', 'Plan Width', 'Actual Startup Time', 'Actual Total Time', 'Actual Rows', 'Actual Loops', 'Rows Removed by Filter', 'Rows Removed by Join Filter', 'Rows Removed by Index Recheck', 'Shared Hit Blocks', 'Shared Read Blocks', 'Shared Dirtied Blocks', 'Shared Written Blocks', 'Local Hit Blocks', 'Local Read Blocks', 'Temp Read Blocks', 'Temp Written Blocks', 'Heap Fetches', 'Sort Space Used', 'Peak Memory Usage']);
const structuralKeys = new Set(['Node Type', 'Join Type', 'Strategy', 'Parent Relationship', 'Scan Direction', 'Sort Method', 'Sort Space Type']);
const sensitiveKeys = /Filter|Cond|Output|Key|Function Call|Expression/;
function safePlan(node, names = new Set()) {
  const result = {};
  for (const [key, value] of Object.entries(node)) {
    if (numericKeys.has(key) && typeof value === 'number') result[key] = value;
    else if (structuralKeys.has(key) && typeof value === 'string' && /^[A-Za-z -]+$/.test(value)) result[key] = value;
    else if (['Relation Name', 'Index Name'].includes(key) && names.has(value)) result[key] = value;
    else if (sensitiveKeys.test(key)) result[key] = '[redacted expression]';
    else if (key === 'Plans') result.Plans = value.map((child) => safePlan(child, names));
  }
  return result;
}
function assertSelect(sql) {
  // Only reviewed SELECT statements, never data-changing CTEs or locking reads.
  if (!/^\s*SELECT\b/i.test(sql) || /;\s*\S/.test(sql) || /\b(INSERT|UPDATE|DELETE|MERGE|CALL|COPY|INTO|pg_sleep|pg_advisory\w*|set_config|nextval|setval|dblink\w*|lo_import|lo_export)\b/i.test(sql)) throw new Error('UNSAFE_SQL');
}
const readMethods = new Set(['findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'findMany', 'count', 'aggregate', 'groupBy']);
function readOnlyClient(tx) {
  return new Proxy({}, { get(_target, name) {
    if (name === '$queryRaw') return (strings, ...values) => {
      if (!Array.isArray(strings) || !strings.raw) throw new Error('RAW_TAG_REQUIRED');
      assertSelect(strings.join(' ? '));
      return tx.$queryRaw(strings, ...values);
    };
    if (typeof name !== 'string' || name.startsWith('$') || !tx[name]) throw new Error('READ_METHOD_REQUIRED');
    return new Proxy({}, { get(_target, method) {
      if (!readMethods.has(method)) throw new Error('READ_METHOD_REQUIRED');
      return tx[name][method].bind(tx[name]);
    } });
  } });
}
function compile(source, context = {}) {
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  // Pure read modules/methods only. No module loader, process, fetch, or lifecycle.
  const exports = {};
  vm.runInNewContext(compiled, { exports, Date, Intl, ...context }, { timeout: 1000 });
  return exports;
}
function method(source, name) {
  const ast = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  const owner = ast.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === 'AttendanceService');
  const found = owner?.members.find((node) => ts.isMethodDeclaration(node) && node.name.getText(ast) === name);
  if (!found) throw new Error('SOURCE_METHOD_MISSING');
  return found.getText(ast);
}
function safeCode(error) {
  return /^[A-Z]\d{4}$/.test(error?.code ?? '') ? error.code : /^[A-Z_]{3,60}$/.test(error?.message ?? '') ? error.message : 'PROBE_FAILED_REDACTED';
}
if (process.argv.includes('--self-test')) {
  const safe = JSON.stringify(safePlan({ 'Node Type': 'Index Scan', 'Index Cond': "id = 'PRIVATE_VALUE'", Filter: 'latitude = 12.34', Output: ['secret'], 'Actual Rows': 1, Plans: [{ 'Node Type': 'Result', 'One-Time Filter': 'private' }] }));
  assert(!safe.includes('PRIVATE_VALUE') && !safe.includes('12.34') && !safe.includes('secret'));
  assert.throws(() => assertSelect('DELETE FROM x'));
  assert.throws(() => assertSelect('SELECT 1; UPDATE x SET y=1'));
  assert.throws(() => assertSelect('SELECT * FROM x FOR UPDATE'));
  assert.throws(() => readOnlyClient({ employee: {} }).employee.update);
  assert.throws(() => readOnlyClient({}).$executeRaw);
  assert.equal(summary(Array.from({ length: 25 }, (_, i) => i + 1)).p95Ms, 24);
  emit('self-test', { passed: true });
  process.exit(0);
}

let db;
let phase = 'configuration';
let events = [];
try {
  const sampleArg = process.argv.find((arg) => arg.startsWith('--samples='));
  const samples = sampleArg ? Number(sampleArg.split('=')[1]) : 25;
  if (!Number.isInteger(samples) || samples < 20 || samples > 30) throw new Error('SAMPLES_MUST_BE_20_TO_30');
  // Parse privately: never export credentials to process.env or print dotenv data.
  const env = parse(fs.readFileSync(path.join(root, '.env')));
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL_MISSING');
  const url = new URL(env.DATABASE_URL);
  const sharedPooler = url.hostname.endsWith('.pooler.supabase.com');
  const region = sharedPooler ? url.hostname.match(/(?:^|-)((?:ap|eu|us|sa|ca|me|af)-(?:[a-z]+-)?\d)\.pooler\.supabase\.com$/)?.[1] ?? 'unrecognized' : 'not-inferred';
  const numericOption = (name) => /^\d+$/.test(url.searchParams.get(name) ?? '') ? Number(url.searchParams.get(name)) : null;
  const mode = url.searchParams.get('sslmode');
  emit('configuration', { node: process.version, platform: process.platform, architecture: process.arch, prisma: Prisma.prismaVersion.client,
    endpointClass: sharedPooler ? 'Supabase shared pooler' : 'other/redacted', hostnameRegion: region,
    port: Number(url.port || 5432), sslmode: ['require', 'verify-full', 'verify-ca', 'prefer', 'disable'].includes(mode) ? mode : 'unset/other',
    connectionLimitConfigured: numericOption('connection_limit'), poolTimeoutConfiguredSeconds: numericOption('pool_timeout'), connectTimeoutConfiguredSeconds: numericOption('connect_timeout'),
    pgbouncerConfigured: url.searchParams.get('pgbouncer') === 'true', directUrlSameEndpoint: env.DIRECT_URL ? new URL(env.DIRECT_URL).host === url.host : null,
    runtimeRegion: 'not-established; local invocation', samples, warmupsPerProbe: 2,
    percentile: 'nearest-rank ceil(0.95*n)', readOnly: true });
  const files = ['apps/api/src/attendance/worker-read-model.ts', 'apps/api/src/attendance/attendance.service.ts', 'apps/api/src/attendance/schedule-evaluator.ts', 'apps/api/src/auth/guards/auth.guard.ts', 'apps/api/src/auth/project-authorization.service.ts'];
  const sources = Object.fromEntries(files.map((file) => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
  const fingerprints = Object.fromEntries(files.map((file) => [file, hash(sources[file])]));
  emit('source-snapshot', { capturedAt: new Date().toISOString(), sha256: fingerprints });
  const readers = compile(sources[files[0]]);
  const dates = compile(sources[files[2]]);
  const Service = compile(`export class ReadService { ${method(sources[files[1]], 'getWorkerToday')} ${method(sources[files[1]], 'loadWorkerToday')} ${method(sources[files[1]], 'listConnectedProjects')} }`, {
    ...readers, timeStep: (_label, fn) => fn(), getSiteDate: dates.getSiteDate, NotFoundException: Error, BadRequestException: Error,
  }).ReadService;
  // A finite connection timeout is diagnostic-only, not persisted to .env.
  if (!url.searchParams.has('connect_timeout')) url.searchParams.set('connect_timeout', '10');
  db = new PrismaClient({ datasources: { db: { url: url.href } }, log: [{ emit: 'event', level: 'query' }] });
  db.$on('query', (event) => { events.push(event); });
  phase = 'connect';
  const connectionStarted = performance.now();
  await db.$connect();
  emit('connection', { wallMs: round(performance.now() - connectionStarted), samples: 1, excludedFromWarmSamples: true });
  phase = 'read-only-probes';
  // Read-only client rejects mutating methods and raw statements. Avoid holding
  // a remote interactive transaction open throughout a multi-minute benchmark.
  {
    const tx = db;
    emit('safety', { selectOnlyClient: true, interactiveTransaction: false });
    const ro = readOnlyClient(tx);
    // Minimal bootstrap discovery only. All subsequent business probes are tenant scoped.
    const account = await ro.telegramAccount.findFirst({ where: { status: 'ACTIVE', employee: { status: 'ACTIVE', currentProjectId: { not: null } } },
      select: { organizationId: true, employeeId: true, telegramUserId: true }, orderBy: { id: 'asc' } });
    if (!account) throw new Error('NO_ACTIVE_WORKER_FIXTURE');
    const principal = { ...account, type: 'worker', sessionId: 'readonly-profiler-no-auth-session' };
    const service = new Service();
    service.prisma = ro;
    const employee = await ro.employee.findFirst({ where: { id: principal.employeeId, organizationId: principal.organizationId }, select: { currentProjectId: true } });
    const projectId = employee.currentProjectId;
    const captured = new Map();
    async function execute(label, fn, remember = true) {
      events = [];
      const started = performance.now();
      await fn();
      const wallMs = performance.now() - started;
      const selects = events.filter((event) => /^\s*SELECT\b/i.test(event.query));
      if (remember && !captured.has(label)) captured.set(label, selects.map((event) => ({ query: event.query, params: event.params })));
      return { wallMs, selects: selects.length, otherStatements: events.length - selects.length, queryMs: selects.reduce((sum, event) => sum + event.duration, 0) };
    }
    const guard = () => ro.telegramAccount.findFirst({ where: { telegramUserId: principal.telegramUserId, employeeId: principal.employeeId, organizationId: principal.organizationId, status: 'ACTIVE', employee: { status: 'ACTIVE' } }, select: { id: true } });
    const probes = [
      ['select1', () => ro.$queryRaw`SELECT 1 AS value`],
      ['active-worker-guard', guard],
      ['connected-projects-service', () => service.listConnectedProjects(principal)],
      ['worker-today-service', () => service.getWorkerToday(principal)],
      ['worker-today-joined-query-only', () => readers.readWorkerAssignments(ro, principal)],
    ];
    phase = 'warmup';
    for (const [label, fn] of probes) for (let i = 0; i < 2; i++) { phase = `warmup-${label}`; await execute(label, fn, false); }
    const measured = new Map(probes.map(([label]) => [label, []]));
    phase = 'samples';
    const samplingStarted = performance.now();
    // Rotate starting probe, keeping concurrency=1 and avoiding block-order bias.
    for (let i = 0; i < samples; i++) {
      for (let j = 0; j < probes.length; j++) {
        const [label, fn] = probes[(i + j) % probes.length];
        measured.get(label).push(await execute(label, fn));
      }
      if ((i + 1) % 5 === 0) emit('progress', { completeSamplesPerProbe: i + 1, elapsedMs: round(performance.now() - samplingStarted) });
    }
    for (const [label, rows] of measured) emit('measurement', { probe: label, ...summary(rows.map((row) => row.wallMs)),
      selectCountMin: Math.min(...rows.map((row) => row.selects)), selectCountMax: Math.max(...rows.map((row) => row.selects)),
      otherStatementCount: rows.reduce((sum, row) => sum + row.otherStatements, 0), prismaQuerySum: summary(rows.map((row) => row.queryMs)), wallSamplesMs: rows.map((row) => round(row.wallMs)) });
    const today = await service.getWorkerToday(principal);
    const siteDate = new Date(`${today.date}T00:00:00.000Z`);
    const scoped = { organizationId: principal.organizationId, employeeId: principal.employeeId };
    const unusedKey = randomUUID();
    const mutationReads = [
      ['mutation-idempotency-miss', () => ro.attendanceRequest.findUnique({ where: { organizationId_employeeId_action_idempotencyKey: { ...scoped, action: 'CHECK_IN', idempotencyKey: unusedKey } } })],
      ['mutation-current-project', () => ro.employee.findFirst({ where: { id: principal.employeeId, organizationId: principal.organizationId, status: 'ACTIVE' }, include: { currentProject: true } })],
      ['mutation-worker-connection-scoped', () => ro.workerProject.findFirst({ where: { ...scoped, projectId } })],
      ['mutation-authorization-project', () => ro.project.findFirst({ where: { id: projectId, organizationId: principal.organizationId } })],
      ['mutation-authorization-account', () => ro.telegramAccount.findFirst({ where: { ...scoped, telegramUserId: principal.telegramUserId, status: 'ACTIVE', employee: { status: 'ACTIVE' } } })],
      ['mutation-assignment-relations', () => ro.assignment.findMany({ where: { ...scoped, status: 'ACTIVE', site: { status: 'ACTIVE', project: { status: 'ACTIVE' } } }, include: { site: true, schedule: true } })],
      ['mutation-today-record-scoped', () => ro.attendanceRecord.findFirst({ where: { ...scoped, assignmentId: today.assignment.id, attendanceDate: siteDate } })],
      ['mutation-open-attendance-relations', () => ro.attendanceRecord.findFirst({ where: { ...scoped, checkInAt: { not: null }, checkOutAt: null }, include: { project: true, assignment: { include: { site: true, schedule: true } } }, orderBy: { checkInAt: 'desc' } })],
      ['outbox-pending-scoped-select-only', () => ro.telegramDelivery.findMany({ where: { organizationId: principal.organizationId, status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: 5 }, nextAttemptAt: { lte: new Date() } }, select: { id: true, organizationId: true }, orderBy: { createdAt: 'asc' }, take: 20 })],
    ];
    phase = 'mutation-path-selects';
    for (const [label, fn] of mutationReads) emit('read-opportunity', { probe: label, ...await execute(label, fn), samples: 1, notMutationLatency: true });
    phase = 'catalog';
    const tables = ['Employee', 'TelegramAccount', 'Project', 'WorkerProject', 'Site', 'WorkSchedule', 'Assignment', 'AttendanceRecord', 'AttendanceRequest', 'TelegramDelivery', 'AttendanceEvent', 'AuditLog'];
    const indexes = await tx.$queryRaw`
      SELECT t.relname AS "table", i.relname AS index, ix.indisunique AS unique, ix.indisvalid AS valid,
        am.amname AS method, ix.indpred IS NOT NULL AS partial, ix.indexprs IS NOT NULL AS expressions,
        ARRAY(SELECT a.attname::text FROM unnest(ix.indkey) WITH ORDINALITY k(attnum, n)
          LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum ORDER BY k.n) AS columns
      FROM pg_index ix JOIN pg_class t ON t.oid=ix.indrelid JOIN pg_class i ON i.oid=ix.indexrelid
      JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_am am ON am.oid=i.relam
      WHERE n.nspname='public' AND t.relname=ANY(${tables}::text[]) ORDER BY t.relname, i.relname`;
    emit('indexes', { indexes });
    const tableStats = await tx.$queryRaw`SELECT relname AS "table", n_live_tup::int AS "estimatedLiveRows", n_dead_tup::int AS "estimatedDeadRows", seq_scan::float8 AS "sequentialScansCumulative", idx_scan::float8 AS "indexScansCumulative" FROM pg_stat_user_tables WHERE schemaname='public' AND relname=ANY(${tables}::text[]) ORDER BY relname`;
    emit('table-statistics', { estimatesNotExactCounts: true, tables: tableStats });
    const activity = await tx.$queryRaw`SELECT state, wait_event_type AS "waitType", count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() GROUP BY state, wait_event_type ORDER BY state, wait_event_type`;
    emit('connection-snapshot', { groups: activity, oneInstantNotCapacity: true });
    const names = new Set([...tables, ...indexes.map((index) => index.index)]);
    phase = 'explain';
    const seen = new Map();
    let planNumber = 0;
    for (const [label, queries] of captured) {
      for (const [queryNumber, query] of queries.entries()) {
        assertSelect(query.query);
        const fingerprint = hash(query.query);
        if (seen.has(fingerprint)) {
          emit('plan-reference', { probe: label, queryNumber: queryNumber + 1, planNumber: seen.get(fingerprint) });
          continue;
        }
        const params = JSON.parse(query.params).map((value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(value) ? new Date(value) : value);
        const [result] = await tx.$queryRawUnsafe('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + query.query, ...params);
        const plan = result['QUERY PLAN'][0];
        seen.set(fingerprint, ++planNumber);
        emit('plan', { probe: label, queryNumber: queryNumber + 1, planNumber, queryFingerprint: fingerprint,
          planningMs: plan['Planning Time'], executionMs: plan['Execution Time'], plan: safePlan(plan.Plan, names) });
      }
    }
    emit('completion', { capturedSelectShapes: planNumber, sourceUnchangedSinceCapture: Object.fromEntries(files.map((file) => [file, hash(fs.readFileSync(path.join(root, file), 'utf8')) === fingerprints[file]])), completedAt: new Date().toISOString() });
  }
} catch (error) {
  emit('error', { phase, code: safeCode(error), details: 'Error message, stack, SQL, connection details and parameters intentionally omitted' });
  process.exitCode = 1;
} finally {
  if (db) await db.$disconnect().catch(() => { process.exitCode = 1; });
}
