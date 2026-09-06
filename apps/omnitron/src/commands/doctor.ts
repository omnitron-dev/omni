/**
 * `omnitron doctor` — diagnose why the platform is unhealthy.
 *
 * ## Why this exists
 *
 * `omnitron health` answers "is anything wrong": it reports a status per
 * check and stops there. Every serious defect found during the 2026-09-04
 * audit shared the opposite problem — the system knew something was wrong
 * and said so in a way nobody would act on:
 *
 *   - schema migrations threw on every boot; the failure was logged as a
 *     WARNING and the daemon carried on against an empty database, so the
 *     visible symptom was `relation "alert_rules" does not exist` repeating
 *     every few seconds for fourteen days;
 *   - a database reconnect left every repository holding a destroyed driver;
 *     the only place it surfaced was a `warn` from one background task;
 *   - apps started outside `startAll` were never sampled, so the dashboard
 *     showed 0% CPU for processes using 105 MB;
 *   - `daos/dev/main` failed to start with `stderrBytes: 0` — the child died
 *     before writing anything, and the timeout message said nothing else.
 *
 * In each case the evidence existed somewhere: a log line, an exit code, a
 * stderr tail, a table that should have had rows. Nothing correlated them.
 *
 * This command does that correlation. Each check answers three questions:
 * WHAT is wrong, WHAT THE EVIDENCE IS, and WHAT TO DO ABOUT IT. A check that
 * cannot say all three is not worth adding — that is exactly the "status
 * without cause" that made the defects above survive.
 *
 * Exit code is 0 when nothing is wrong, 1 when any finding is an error, so
 * the command is usable as a CI or pre-deploy gate.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { box, log, prism } from '@xec-sh/kit';

import { createDaemonClient } from '../daemon/daemon-client.js';
import { DEFAULT_DAEMON_CONFIG, OMNITRON_HOME } from '../config/defaults.js';
import type { IDaemonConfig } from '../config/types.js';
import { emitJson, isJsonMode } from './output.js';
import { resolveOmnitronPgConfig } from '../database/connection.js';
import { OMNITRON_MIGRATIONS } from '../database/migrations/index.js';
import type { ProcessInfoDto } from '../config/types.js';
import { compareTrees, listTree, processPredatesBuild } from '../shared/build-freshness.js';
import {
  findDominantErrors,
  findRetryLoops,
  findDuplicatedLogs,
  describeFinding,
} from './log-health.js';

/**
 * How long the daemon may take to answer before that is itself a finding.
 * Generous: the call is local and normally answers in milliseconds, so this
 * fires for a blocked supervisor, not for a busy machine.
 */
const SLOW_DAEMON_MS = 3_000;

/**
 * How long an app may spend in a transitional state before it is stuck.
 *
 * Matches the daemon's own `resources.timeout` for a spawn (60s), doubled:
 * a bootstrap app under load legitimately takes most of that budget, and a
 * diagnostic that fires while the supervisor is still waiting would be
 * reporting on the supervisor rather than on the app.
 */
const STARTUP_BUDGET_MS = 120_000;

/**
 * How long after an app goes `online` its topology processes may still be
 * starting.
 *
 * An app reports online from its main process; the rest come up alongside
 * it. Thirty seconds is generous for that and short enough that a process
 * which never starts is still reported within a minute.
 */
const SUBPROCESS_SETTLE_MS = 30_000;

/**
 * How long after a container starts its published ports may still be silent.
 *
 * Postgres replays WAL before it listens, and an image that has to run
 * initdb takes longer still. Fifteen seconds is past both on any machine
 * that can run them at all.
 */
const CONTAINER_SETTLE_MS = 15_000;

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export type FindingSeverity = 'error' | 'warning' | 'info';

export interface Finding {
  /** Stable identifier, so scripts can match on it. */
  id: string;
  severity: FindingSeverity;
  /** One line: what is wrong. */
  title: string;
  /** What was actually observed — the reason to believe the title. */
  evidence: string[];
  /** What the operator should do next. Omitted only when nothing to do. */
  remedy?: string;
}

/** Collected during a run; rendered together at the end. */
export class Findings {
  private readonly items: Finding[] = [];

  add(finding: Finding): void {
    this.items.push(finding);
  }

  all(): Finding[] {
    // Errors first, then warnings, then info — an operator reads top-down.
    const rank: Record<FindingSeverity, number> = { error: 0, warning: 1, info: 2 };
    return [...this.items].sort((a, b) => rank[a.severity] - rank[b.severity]);
  }

  get worst(): FindingSeverity | null {
    if (this.items.some((f) => f.severity === 'error')) return 'error';
    if (this.items.some((f) => f.severity === 'warning')) return 'warning';
    return this.items.length > 0 ? 'info' : null;
  }
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * Every table the daemon's Postgres schema declares.
 *
 * This used to name five of the fifteen. A check that covers a third of the
 * schema can miss the exact failure it was built for: `omnitron_users` was
 * not on the list, so a database that had lost the table nobody can sign in
 * without would have been reported healthy.
 *
 * Kept as a literal rather than derived, because the point is to notice a
 * table that is GONE — deriving it from the live database would make the
 * comparison vacuous. `doctor-required-tables.test.ts` keeps it honest from
 * the other side, reading `OmnitronDatabase` out of `schema.ts` and failing
 * when the two disagree, so adding a table to the schema and forgetting this
 * list is a red test rather than a silent gap.
 */
export const REQUIRED_TABLES = [
  'nodes',
  'omnitron_users',
  'omnitron_sessions',
  'logs',
  'metrics_raw',
  'alert_rules',
  'alert_events',
  'deployments',
  'omnitron_audit_log',
  'pipelines',
  'pipeline_runs',
  'traces',
  'sync_buffer',
  'sync_ingested',
  'node_health_checks',
] as const satisfies readonly string[];

/**
 * The internal database: reachable, migrated, and actually holding the tables
 * the daemon queries.
 *
 * Checking "did migrations run" by asking the bookkeeping table is not
 * enough — the fourteen-day outage had an EMPTY database and no bookkeeping
 * table at all, because the runner threw before creating one. So this looks
 * for the tables themselves.
 */
async function checkDatabase(findings: Findings): Promise<void> {
  const { host, port, database } = resolveOmnitronPgConfig();
  const target = `${host}:${port}/${database}`;

  let db;
  try {
    const { createOmnitronDb } = await import('../database/connection.js');
    db = await createOmnitronDb<unknown>({ max: 1, connectionTimeoutMillis: 5_000 });
  } catch (err) {
    findings.add({
      id: 'db.unreachable',
      severity: 'error',
      title: 'Cannot connect to the Omnitron database',
      evidence: [`target: ${target}`, `error: ${describeError(err)}`],
      remedy: 'Start the omnitron-pg container (`omnitron up`), or point OMNITRON_DATABASE_URL at a reachable server.',
    });
    return;
  }

  try {
    const { sql } = await import('kysely');

    const tables = await sql<{ tablename: string }>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `.execute(db);
    const present = new Set(tables.rows.map((r) => r.tablename));

    if (present.size === 0) {
      findings.add({
        id: 'db.empty',
        severity: 'error',
        title: 'The Omnitron database has no tables',
        evidence: [
          `target: ${target}`,
          `expected ${OMNITRON_MIGRATIONS.length} migration(s) to have run`,
        ],
        remedy:
          'Run `omnitron infra migrate`. If it fails, the error it prints is the real problem — the daemon only logs migration failures as warnings at boot.',
      });
      return;
    }

    // Which migrations does the bookkeeping table say ran?
    let applied = new Set<string>();
    if (present.has('migrations')) {
      const rows = await sql<{ name: string }>`SELECT name FROM migrations`.execute(db);
      applied = new Set(rows.rows.map((r) => r.name));
    }

    const pending = OMNITRON_MIGRATIONS.filter((m) => !applied.has(m.name)).map((m) => m.name);
    if (pending.length > 0) {
      findings.add({
        id: 'db.pending-migrations',
        severity: 'error',
        title: `${pending.length} migration(s) have not been applied`,
        evidence: [`target: ${target}`, `pending: ${pending.join(', ')}`],
        remedy: 'Run `omnitron infra migrate`.',
      });
    }

    // Checked by name rather than inferred from bookkeeping: a database can
    // carry migration rows and still be missing tables if someone dropped
    // them — which is the outage this whole command was written for.
    const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
    if (missing.length > 0) {
      findings.add({
        id: 'db.missing-tables',
        severity: 'error',
        title: 'Tables the daemon queries are missing',
        evidence: [`target: ${target}`, `missing: ${missing.join(', ')}`],
        remedy:
          'Run `omnitron infra migrate`. Until these exist, alert evaluation and session cleanup fail on every tick and log a warning each time.',
      });
    }

    // What the log table itself says about the platform's health.
    if (present.has('logs')) await checkLogHealth(findings, db);

    if (present.has('alert_rules')) await checkAlertRules(findings, db);

    await checkTableGrowth(findings, db, target);
  } catch (err) {
    findings.add({
      id: 'db.query-failed',
      severity: 'error',
      title: 'The Omnitron database is reachable but not queryable',
      evidence: [`target: ${target}`, `error: ${describeError(err)}`],
      remedy: 'Check the database logs — the connection opened, so this is a permissions or schema problem.',
    });
  } finally {
    await db.destroy().catch(() => undefined);
  }
}

/** A table this large is worth a finding at all. */
const TABLE_WARN_BYTES = 1024 ** 3;

/**
 * Bytes per live row above which the space is not the rows.
 *
 * A log line is a few hundred bytes and the widest row this schema holds is
 * well under a kilobyte, so 8 KiB — one Postgres page per row — is far past
 * anything the contents can explain, and far below the ~207 KiB per row this
 * host was measured at.
 */
const BLOAT_BYTES_PER_ROW = 8 * 1024;

/** Space each surviving row is costing. `Infinity` when nothing survives. */
export function bytesPerLiveRow(bytes: number, live: number): number {
  return live > 0 ? bytes / live : Infinity;
}

/**
 * Is a table's size explained by its contents?
 *
 * Split out so the judgement can be tested against real figures without a
 * database: the SQL that gathers them is exercised by running the command.
 */
export function looksBloated(bytes: number, live: number): boolean {
  return bytes >= TABLE_WARN_BYTES && bytesPerLiveRow(bytes, live) > BLOAT_BYTES_PER_ROW;
}

/**
 * How much disk the database is holding, and whether the rows justify it.
 *
 * On this platform the largest consumer is the `logs` table, which until
 * recently had no retention at all: 22.5 million rows and 13 GB of a 17 GB
 * schema. Retention now runs — and the table is still 13 GB, because
 * `DELETE` does not return space to the operating system. Plain `VACUUM`
 * marks the pages reusable INSIDE the file; it truncates the file only when
 * the free pages happen to sit at the end. So a table can hold 62 000 live
 * rows in thirteen gigabytes indefinitely, and every measurement taken from
 * its size alone — a growth rate, a projection of when the disk fills — is
 * arithmetic on a number that stopped meaning "contents" long ago.
 *
 * That is why the check divides. Size on its own says "large"; size per live
 * row says which KIND of large, and the two have opposite remedies: shorten
 * the retention window, or reclaim the file.
 */
async function checkTableGrowth(findings: Findings, db: unknown, target: string): Promise<void> {
  const ERROR_BYTES = 5 * 1024 ** 3;
  /**
   * Bytes per live row above which the space is not the rows.
   *
   * A log line is a few hundred bytes and the widest row this schema holds
   * is well under a kilobyte, so 8 KB — one Postgres page per row — is far
   * past anything the contents can explain, and far below the ~218 KB per
   * row this host was measured at.
   */
  const { sql } = await import('kysely');
  const gib = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GiB`;

  const sizes = await sql<{ relname: string; bytes: string; live: string; total: string }>`
    SELECT c.relname,
           pg_total_relation_size(c.oid)::text AS bytes,
           COALESCE(st.n_live_tup, 0)::text AS live,
           (SELECT sum(pg_total_relation_size(i.oid))::text
              FROM pg_class i JOIN pg_namespace m ON m.oid = i.relnamespace
             WHERE m.nspname = 'public' AND i.relkind = 'r') AS total
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stat_user_tables st ON st.relid = c.oid
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY pg_total_relation_size(c.oid) DESC
     LIMIT 3
  `.execute(db as never);

  if (sizes.rows.length === 0) return;
  const total = Number(sizes.rows[0]!.total ?? 0);
  if (!Number.isFinite(total) || total < TABLE_WARN_BYTES) return;

  const biggest = sizes.rows[0]!;
  const bytes = Number(biggest.bytes);
  const live = Number(biggest.live);
  const perRow = bytesPerLiveRow(bytes, live);

  // Bloat first: when it is the answer, the size finding below would send an
  // operator to shorten a retention window that is already working.
  if (looksBloated(bytes, live)) {
    const disk = await diskAtHome();
    findings.add({
      id: 'db.bloated',
      severity: 'warning',
      title: `Table "${biggest.relname}" occupies ${gib(bytes)} for ${live.toLocaleString('en-US')} live row(s)`,
      evidence: [
        `target: ${target}`,
        `${(perRow / 1024).toFixed(0)} KiB per live row — the rows are a few hundred bytes`,
        ...(disk ? [`${gib(disk.free)} free on the filesystem holding ${OMNITRON_HOME}`] : []),
      ],
      remedy:
        'Retention is doing its job; the space it frees is not being returned. `DELETE` leaves the pages inside ' +
        'the file, and plain `VACUUM` only makes them reusable — the file shrinks only when the free pages ' +
        `happen to be at the end. Reclaim it with \`VACUUM FULL ${biggest.relname}\` (an ACCESS EXCLUSIVE lock ` +
        'for the duration, so schedule it) or `pg_repack` (no long lock, needs the extension). Until then this ' +
        'space is unavailable to anything else on the disk, and a full disk on this host has been diagnosed ' +
        'once as an auth fault and once as a Docker networking fault.',
    });
    return;
  }

  const evidence = [
    `target: ${target}`,
    `largest: ${sizes.rows.map((r) => `${r.relname} ${gib(Number(r.bytes))}`).join(', ')}`,
  ];

  // The age of the oldest surviving row answers "is pruning happening",
  // which the size alone does not: a large table inside its window is a busy
  // platform, the same size outside it is a retention pass that is not running.
  try {
    const oldest = await sql<{ oldest: Date | null }>`
      SELECT min(timestamp) AS oldest FROM logs
    `.execute(db as never);
    const at = oldest.rows[0]?.oldest;
    if (at) {
      const days = (Date.now() - new Date(at).getTime()) / 86_400_000;
      evidence.push(`oldest surviving log row is ${days < 1 ? '<1' : days.toFixed(0)} day(s) old`);
    }
  } catch {
    // No `logs` table, or no `timestamp` column on it. The size finding
    // stands on its own.
  }

  findings.add({
    id: total >= ERROR_BYTES ? 'db.oversized' : 'db.growing',
    severity: total >= ERROR_BYTES ? 'error' : 'warning',
    title: `The Omnitron database occupies ${gib(total)}`,
    evidence,
    remedy:
      'Compare the oldest row above against `logging.databaseRetentionDays` in the ecosystem config (14 by default, ' +
      '0 disables pruning entirely). History older than that window means the retention pass is not running — it is ' +
      'armed by the log collector at daemon start, so a daemon that failed to arm it prunes nothing and says nothing. ' +
      'Note that `logging.maxSize` and `logging.maxFiles` govern the rotated FILES and have no effect on the table.',
  });
}

/**
 * Alert rules the evaluator cannot read.
 *
 * An expression that matches none of the supported forms is answered with
 * `firing: false` — the same answer a healthy platform gives — so the rule
 * sits in the console enabled, green, and permanently inert. Somebody wrote
 * it to catch a condition; the platform is not catching it, and the only
 * other place that says so is a line in the daemon log, once a cycle,
 * addressed to nobody.
 *
 * Checked against the evaluator's own list of forms rather than a copy, so
 * the two cannot come to disagree about which rules work.
 */
async function checkAlertRules(findings: Findings, db: unknown): Promise<void> {
  const { sql } = await import('kysely');
  const { isAlertExpressionParseable } = await import('../services/alert.service.js');

  const rows = await sql<{ id: string; name: string; expression: string }>`
    SELECT id, name, expression FROM alert_rules WHERE enabled = true
  `.execute(db as never);

  const broken = rows.rows.filter((r) => !isAlertExpressionParseable(r.expression));
  if (broken.length === 0) return;

  findings.add({
    id: 'alerts.unreadable-rule',
    severity: 'warning',
    title: `${broken.length} enabled alert rule(s) can never fire`,
    evidence: broken.slice(0, 5).map((r) => `"${r.name}": ${r.expression}`),
    remedy:
      'The evaluator understands three forms: `app.<name|*>.status != <status>`, ' +
      '`app.<name|*>.<cpu|memory> <op> <number>` and `infra.<name|*>.health != <status>`. ' +
      'Anything else evaluates to "not firing", which is indistinguishable from a healthy ' +
      'platform — so these rules show as enabled and green while catching nothing. ' +
      'Fix or disable them: an alert nobody can rely on is worse than an absent one.',
  });
}

/**
 * The log table as a symptom.
 *
 * A message repeated far more often than anything else is a loop that cannot
 * make progress, and it is invisible from every surface an operator normally
 * looks at: the logs page shows the most recent lines, which are all the same
 * line; the alerts page shows rules nobody wrote for a failure nobody
 * predicted; and the daemon reports itself healthy throughout, because it is.
 *
 * This host carried 2.5 million copies of one message across three days —
 * one event retried 799 289 times — and 13 GB of log table, most of it that.
 * Nothing said so.
 */
async function checkLogHealth(findings: Findings, db: unknown): Promise<void> {
  const { sql } = await import('kysely');
  // The Kysely instance, typed loosely: this module holds no schema type for
  // the omnitron database and the query is raw SQL either way.
  const database = db as never;

  // A day: long enough that a loop stands out against ordinary noise, short
  // enough that yesterday's fixed problem does not keep reporting itself.
  const rows = await sql<{ app: string; message: string; count: string; max_retry: string | null }>`
    SELECT app,
           left(message, 80) AS message,
           count(*)::text AS count,
           max((metadata->>'retryCount')::bigint)::text AS max_retry
    FROM logs
    WHERE level IN ('error', 'fatal')
      AND timestamp > now() - interval '24 hours'
    GROUP BY app, left(message, 80)
    ORDER BY count(*) DESC
    LIMIT 50
  `.execute(database);

  const counts = rows.rows.map((r) => ({
    app: r.app,
    message: r.message,
    count: Number(r.count),
    retryCount: Number(r.max_retry ?? 0),
  }));

  for (const finding of findDominantErrors(counts)) {
    findings.add({
      id: 'logs.dominant-error',
      severity: 'warning',
      title: `One message is ${Math.round((finding.share ?? 0) * 100)}% of the last day's errors`,
      evidence: [
        describeFinding(finding),
        'a message repeating at this share is a loop that cannot make progress, not background noise',
      ],
      remedy: `Read it: \`omnitron logs ${finding.app} --level error\`. The same line repeating means the work behind it is not getting done.`,
    });
  }

  // Lines stored under two app names at the same instant. A join over a
  // short window rather than the whole table: the point is to detect the
  // condition, not to count every instance of it.
  const dupes = await sql<{ app: string; other_app: string; count: string }>`
    SELECT a.app, b.app AS other_app, count(*)::text AS count
    FROM logs a
    JOIN logs b ON a.timestamp = b.timestamp AND a.message = b.message AND a.app < b.app
    WHERE a.timestamp > now() - interval '15 minutes'
    GROUP BY a.app, b.app
  `.execute(database);

  const recentTotal = await sql<{ count: string }>`
    SELECT count(*)::text AS count FROM logs WHERE timestamp > now() - interval '15 minutes'
  `.execute(database);

  for (const finding of findDuplicatedLogs(
    dupes.rows.map((r) => ({ app: r.app, otherApp: r.other_app, count: Number(r.count) })),
    Number(recentTotal.rows[0]?.count ?? 0)
  )) {
    findings.add({
      id: 'logs.duplicated',
      severity: 'warning',
      title: 'Log lines are being stored twice',
      evidence: [
        describeFinding(finding),
        'titan-pm re-logs child output through the daemon logger while the orchestrator is already capturing it',
        'the table pays for both copies, and every per-app count is wrong by whichever component emitted the line',
      ],
      remedy: 'Nothing to do at runtime — the duplicate path is in the process spawner, not in configuration.',
    });
  }

  for (const finding of findRetryLoops(counts.filter((c) => c.retryCount > 0))) {
    findings.add({
      id: 'logs.retry-loop',
      severity: 'error',
      title: 'An operation is being retried without limit',
      evidence: [
        describeFinding(finding),
        'a retry policy has a ceiling; a count this high means there is none, and the work will never complete',
      ],
      remedy: `Find the stuck item and either fix or discard it — retrying is not going to work. \`omnitron logs ${finding.app} --level error\` carries its id.`,
    });
  }
}

/**
 * Apps: what is not running, and — crucially — WHY.
 *
 * The daemon already captures an exit code, a signal and a stderr tail for
 * every crash. `omnitron list` shows none of it: an app reads as `errored`
 * with no further explanation, which is how `daos/dev/main` sat broken for a
 * whole session.
 */
async function checkApps(
  findings: Findings,
  client: ReturnType<typeof createDaemonClient>,
  apps: ProcessInfoDto[]
): Promise<void> {
  for (const app of apps) {
    if (app.status === 'online') continue;

    // A stopped app is a state, not a fault — unless it is critical.
    if (app.status === 'stopped' && !app.critical) continue;

    const evidence: string[] = [`status: ${app.status}`];
    let remedy = `Inspect it with \`omnitron inspect ${app.name}\`, then \`omnitron start ${app.name}\`.`;

    try {
      const diag = await client.inspect({ name: app.name });
      const exit = diag.lastExit;

      if (exit) {
        evidence.push(`exited at ${exit.atIso}`);
        if (exit.signal) evidence.push(`killed by ${exit.signal}`);
        else if (exit.code !== null) evidence.push(`exit code ${exit.code}`);
        if (exit.message) evidence.push(`message: ${exit.message}`);

        if (exit.stderrTail.length > 0) {
          // Start-up stages are written to stderr as `[omnitron:boot] <stage>`
          // (see bootstrap-process.ts). The LAST one is the stage that never
          // completed — which turns "timed out after 30000ms" from a fact
          // about the supervisor into a fact about the app.
          const stages = exit.stderrTail
            .map((line) => /\[omnitron:boot\]\s+(\S+)/.exec(line)?.[1])
            .filter((stage): stage is string => Boolean(stage));

          if (stages.length > 0) {
            const stalled = stages[stages.length - 1]!;
            evidence.push(`reached stage: ${stalled}`);
            if (stalled !== 'ready') {
              remedy = stageRemedy(stalled, app.name);
            }
          }

          // The last few lines are almost always the actual error.
          const realOutput = exit.stderrTail.filter((line) => !line.includes('[omnitron:boot]'));
          if (realOutput.length > 0) {
            evidence.push('last stderr:');
            for (const line of realOutput.slice(-5)) evidence.push(`  ${line}`);
          }
        } else {
          // Silence is itself a finding: it narrows the cause sharply.
          evidence.push('stderr: (empty — the process died before writing anything)');
          remedy =
            `Run the entry point directly to see the failure: the child produced no output, which usually means ` +
            `it crashed during module import or blocked before its first log line. \`omnitron inspect ${app.name}\` shows the resolved command.`;
        }

        if (exit.signal === 'SIGKILL') {
          remedy = 'SIGKILL usually means the OOM killer or a hard timeout. Check available memory and the app\'s startupTimeout.';
        }
      } else {
        evidence.push('no exit record — the app has not started, rather than started and died');
      }
    } catch (err) {
      evidence.push(`could not read diagnostics: ${describeError(err)}`);
    }

    // `starting` and `stopping` are transitions, not faults. An app three
    // seconds into a restart is doing exactly what it should, and reporting
    // it as an error next to a crashed one teaches an operator that the
    // error column means nothing.
    //
    // A transition that has outlasted the start-up budget is a different
    // thing: nothing is coming, and the app is hung rather than starting.
    // `uptime` on a transitional app measures how long it has been in that
    // state, which is the only clock available here.
    const transitional = app.status === 'starting' || app.status === 'stopping';
    const stuck = transitional && app.uptime > STARTUP_BUDGET_MS;

    if (transitional && !stuck) {
      findings.add({
        id: `app.${app.status}`,
        severity: 'info',
        title: `App "${app.name}" is ${app.status}`,
        evidence: [`status: ${app.status}`, `for ${Math.round(app.uptime / 1000)}s`],
        remedy: `Run \`omnitron doctor\` again — if it is still ${app.status}, it is stuck rather than slow.`,
      });
      continue;
    }

    if (stuck) {
      evidence.push(`in this state for ${Math.round(app.uptime / 1000)}s`);
      evidence.push(`the start-up budget is ${STARTUP_BUDGET_MS / 1000}s`);
      remedy = `It is not starting slowly, it is not starting. \`omnitron logs ${app.name}\` shows how far it got.`;
    }

    findings.add({
      id: `app.${app.status}`,
      severity: app.critical ? 'error' : 'warning',
      title: `${app.critical ? 'Critical app' : 'App'} "${app.name}" is ${stuck ? `stuck ${app.status}` : app.status}`,
      evidence,
      remedy,
    });
  }

  // Metrics that never move are the signature of a sampler that is not
  // running — precisely the defect where apps started outside `startAll`
  // reported 0% CPU while holding 105 MB.
  const online = apps.filter((a) => a.status === 'online');
  const allZero = online.length > 0 && online.every((a) => a.cpu === 0 && a.memory === 0);
  if (allZero) {
    findings.add({
      id: 'metrics.not-sampled',
      severity: 'warning',
      title: 'No CPU or memory readings for any running app',
      evidence: [
        `${online.length} app(s) online, every one reporting cpu 0 and memory 0`,
        'a running Node process is never truly at 0 MB',
      ],
      remedy:
        'Metrics sampling is armed from the daemon config. Restart the daemon (`omnitron down && omnitron up`); if the readings stay at zero, the sampler is not running.',
    });
  }
}

/**
 * What an app hides behind `online`.
 *
 * `omnitron list` reports one status per app, taken from its main process.
 * A bootstrap app is several processes, and everything that goes wrong with
 * the others is invisible at that level — which is how two pool workers spent
 * a full session being killed and respawned every thirty seconds while their
 * apps read `online` throughout. These three checks look underneath.
 */
export async function checkAppInternals(findings: Findings, apps: ProcessInfoDto[]): Promise<void> {
  for (const app of apps) {
    if (app.status !== 'online') continue;

    for (const proc of app.processes ?? []) {
      // A sub-process whose pid the OS no longer knows. The orchestrator
      // reports this as `crashed` rather than `stopped` precisely so it can
      // be told apart from one that was never started.
      if (proc.status === 'crashed') {
        findings.add({
          id: 'app.subprocess-crashed',
          severity: 'error',
          title: `"${app.name}" is online but its "${proc.name}" process is gone`,
          evidence: [
            `app status: online (pid ${app.pid})`,
            `${proc.name}: ${proc.type}, last known pid ${proc.pid ?? 'none'} — no such process`,
          ],
          remedy: `Restart the app (\`omnitron restart ${app.name}\`) and check its log for what killed that process.`,
        });
        continue;
      }

      if (proc.status === 'stopped') {
        // An app reports `online` as soon as its main process is up, and its
        // topology processes come up around the same time — so a child that
        // is still stopped a few seconds in is being started, not missing.
        // Reported either way, because it may be the last thing said before
        // it never starts, but at the weight the age warrants.
        const settling = app.uptime < SUBPROCESS_SETTLE_MS;
        findings.add({
          id: 'app.subprocess-stopped',
          severity: settling ? 'info' : 'warning',
          title: settling
            ? `"${app.name}" is online and its "${proc.name}" process has not started yet`
            : `"${app.name}" is online but its "${proc.name}" process is not running`,
          evidence: [
            `${proc.name}: ${proc.type}, declared in the app's topology, no pid`,
            `app online for ${Math.round(app.uptime / 1000)}s`,
          ],
          remedy: settling
            ? `Run \`omnitron doctor\` again — after ${SUBPROCESS_SETTLE_MS / 1000}s this stops being start-up.`
            : `Whatever this process does is not happening. \`omnitron inspect ${app.name}\` shows the resolved topology.`,
        });
        continue;
      }

      // A pool that no longer matches its declaration. Growth is the easy
      // case to miss: a pool with more workers than asked for still reports
      // itself healthy, because it does have workers.
      if (proc.declaredInstances > 0 && proc.instances !== proc.declaredInstances) {
        const grown = proc.instances > proc.declaredInstances;
        findings.add({
          id: grown ? 'pool.oversized' : 'pool.undersized',
          severity: 'warning',
          title: `Pool "${app.name}/${proc.name}" is running ${proc.instances} workers, not the ${proc.declaredInstances} declared`,
          evidence: [
            `declared instances: ${proc.declaredInstances}`,
            `live workers: ${proc.instances}`,
          ],
          remedy: grown
            ? 'Autoscaling only applies to a pool whose topology entry sets `scaling.strategy: "auto"`. If this one does not, the pool grew without being asked to.'
            : 'Workers are dying faster than the pool replaces them — check the app log for their exit reason.',
        });
      }
    }
  }
}

/**
 * Can something on this host open a TCP connection to `port`?
 *
 * Shared by the app-port and container-port checks, which ask the same
 * question of two different claimants. Deliberately a connect and nothing
 * more: the question is whether a listener exists, not whether it speaks any
 * particular protocol.
 */
async function tcpReachable(port: number, host = '127.0.0.1', timeoutMs = 1_000): Promise<boolean> {
  const net = await import('node:net');
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

/**
 * An app that answers `online` while nothing is listening on its port.
 *
 * The supervisor's notion of "online" is that the process exists. Whether it
 * ever finished binding is a different question, and the one an operator is
 * actually asking when a request fails.
 */
export async function checkPorts(findings: Findings, apps: ProcessInfoDto[]): Promise<void> {
  for (const app of apps) {
    if (app.status !== 'online' || app.port === null) continue;
    if (await tcpReachable(app.port)) continue;

    findings.add({
      id: 'app.port-unreachable',
      severity: 'error',
      title: `"${app.name}" is online but nothing is listening on port ${app.port}`,
      evidence: [
        `app status: online (pid ${app.pid})`,
        `TCP connect to 127.0.0.1:${app.port} refused or timed out`,
      ],
      remedy:
        `The process is alive but its HTTP transport never bound, or bound elsewhere. ` +
        `Check the app log around start-up; \`omnitron inspect ${app.name}\` shows the port it was told to use.`,
    });
  }
}

/**
 * Turn a stalled start-up stage into advice.
 *
 * Each stage narrows the cause sharply, which is the entire point of emitting
 * them: "timed out after 30s" is a fact about the supervisor, "stalled at
 * application:starting" is a fact about the app.
 */
function stageRemedy(stage: string, appName: string): string {
  if (stage.startsWith('config:')) {
    return 'Start-up stalled while loading the bootstrap config — check that the file parses and that any imports it performs terminate.';
  }
  if (stage.startsWith('module:')) {
    return 'Start-up stalled importing the app module. Top-level `await` in the module graph is the usual cause; run the built entry point directly to reproduce.';
  }
  if (stage === 'application:creating' || stage === 'application:created') {
    return 'Start-up stalled in `Application.create` — a provider factory is not resolving. Try `omnitron inspect ' + appName + ' --graph` to see the DI closure.';
  }
  if (stage === 'application:starting') {
    return 'Start-up stalled in `Application.start` — an `onStart` hook is not returning. A module waiting on a database or Redis that never answers is the common case.';
  }
  if (stage.startsWith('hook:')) {
    return `Start-up stalled in the "${stage.slice(5)}" lifecycle hook declared by this app's bootstrap file.`;
  }
  return `Start-up stalled at "${stage}".`;
}

/** The daemon's own footing: uptime, and whether it is reporting its own faults. */
async function checkDaemon(findings: Findings, client: ReturnType<typeof createDaemonClient>): Promise<void> {
  const status = await client.status();

  // A daemon that restarts constantly loses the in-memory state everything
  // else depends on, so short uptime with running apps is worth surfacing.
  const uptimeMinutes = Math.floor((status.uptime ?? 0) / 60_000);
  if (uptimeMinutes < 2 && status.apps.length > 0) {
    findings.add({
      id: 'daemon.recently-restarted',
      severity: 'info',
      title: 'The daemon restarted less than two minutes ago',
      evidence: [`uptime: ${uptimeMinutes}m`, `apps tracked: ${status.apps.length}`],
      remedy: 'If this was not deliberate, check `omnitron logs` for the shutdown that preceded it.',
    });
  }

  // The daemon aggregates CPU across every managed process. Zero while apps
  // are online is the same signature as the per-app check below, seen from
  // the other end.
  if (status.apps.some((a) => a.status === 'online') && status.totalMemory === 0) {
    findings.add({
      id: 'daemon.no-aggregate-metrics',
      severity: 'info',
      title: 'The daemon reports zero total memory across running apps',
      evidence: [`apps online: ${status.apps.filter((a) => a.status === 'online').length}`],
      remedy: 'Usually the same cause as any "no CPU or memory readings" finding below.',
    });
  }
}

/**
 * Is the daemon running the code in this checkout?
 *
 * Everything here loads through `dist`, and nothing else asks whether `dist`
 * matches `src`. The two ways that goes wrong are different findings because
 * they have different remedies: a source edited since the last build needs a
 * build, and a daemon started before the last build needs a restart. Both
 * present identically — as a change that appears to have had no effect.
 *
 * Only meaningful in a development checkout. An installed package has no
 * `src/`, and the check produces nothing rather than guessing.
 */
async function checkBuildFreshness(findings: Findings, daemonStartedMs: number | null): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // `dist/commands/` at runtime, `src/commands/` under a source runner.
  const packageRoot = path.resolve(here, '../..');
  const sourceRoot = path.join(packageRoot, 'src');
  const buildRoot = path.join(packageRoot, 'dist');

  if (!fs.existsSync(sourceRoot) || !fs.existsSync(buildRoot)) return;

  const report = compareTrees(listTree(sourceRoot), listTree(buildRoot));
  if (!report.comparable) return;

  if (report.unbuilt.length > 0) {
    findings.add({
      id: 'build.unbuilt-sources',
      severity: 'warning',
      title: `${report.unbuilt.length} source file(s) have never been built`,
      evidence: [
        ...report.unbuilt.slice(0, 5).map((f) => `src/${f} → no dist counterpart`),
        ...(report.unbuilt.length > 5 ? [`… and ${report.unbuilt.length - 5} more`] : []),
        'the daemon loads dist/, so this code has not run',
      ],
      remedy: 'Run `pnpm build` in apps/omnitron.',
    });
  }

  if (report.stale.length > 0) {
    findings.add({
      id: 'build.stale-sources',
      severity: 'warning',
      title: `${report.stale.length} source file(s) are newer than their build output`,
      evidence: [
        ...report.stale.slice(0, 5).map((f) => `src/${f}`),
        ...(report.stale.length > 5 ? [`… and ${report.stale.length - 5} more`] : []),
        'modification time is the signal, so a file copied back over itself counts as changed',
      ],
      remedy: 'Run `pnpm build` in apps/omnitron, then restart the daemon.',
    });
  }

  const predates = processPredatesBuild(daemonStartedMs ?? 0, report.newestArtifactMs);
  if (predates === true) {
    findings.add({
      id: 'build.daemon-predates-build',
      severity: 'warning',
      title: 'The daemon started before the current build was written',
      evidence: [
        `daemon started: ${new Date(daemonStartedMs!).toISOString()}`,
        `newest build artifact: ${new Date(report.newestArtifactMs).toISOString()}`,
        'it is running the previous build, which is no longer on disk to inspect',
      ],
      remedy: 'Restart the daemon: `omnitron down && omnitron up`.',
    });
  }
}

/**
 * Free space on the filesystem holding omnitron's own state.
 *
 * A disk that fills does not report itself as a disk that filled. It reports
 * itself as Postgres refusing writes, as the daemon dying without a message,
 * as a login endpoint answering 500 — this project has diagnosed it as an
 * auth bug once and as a Docker networking bug once, and both times the
 * answer was `df`. Asking directly costs one syscall.
 *
 * The threshold is absolute rather than proportional on purpose: what fails
 * is a WAL segment that cannot be written or an image layer that cannot be
 * unpacked, and those need gigabytes, not percentages. A 2 TB disk at 3% free
 * still has 60 GB and is fine; a 32 GB disk at 10% free has 3 GB and is not.
 */
/** Free and total bytes where omnitron writes, or null when unreadable. */
async function diskAtHome(): Promise<{ free: number; total: number } | null> {
  try {
    const st = await fs.promises.statfs(OMNITRON_HOME);
    return { free: st.bavail * st.bsize, total: st.blocks * st.bsize };
  } catch {
    // No statfs, or the home does not exist yet. Neither is a disk fault.
    return null;
  }
}

export async function checkDiskSpace(findings: Findings): Promise<void> {
  const ERROR_BYTES = 2 * 1024 ** 3;
  const WARN_BYTES = 10 * 1024 ** 3;

  const disk = await diskAtHome();
  if (!disk) return;
  const { free, total } = disk;

  if (free >= WARN_BYTES) return;

  const gib = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GiB`;
  const evidence = [
    `${gib(free)} available of ${gib(total)} on the filesystem holding ${OMNITRON_HOME}`,
  ];

  // Measured, not assumed. An earlier version of this check named the log
  // directory — the plausible culprit for a tool that writes logs. On this
  // host the logs are 163 MiB of a 7.4 GiB footprint, while `projects`
  // holds 4.4 GiB of build artefacts and `backups` 2.8 GiB, so the evidence
  // would have sent an operator to clean the one directory that was already
  // rotating properly.
  const parts = biggestSubdirectories(OMNITRON_HOME, 3);
  if (parts.length > 0) {
    evidence.push(
      `omnitron's own ${gib(parts.reduce((n, d) => n + d.bytes, 0))} sits mostly in ` +
        parts.map((d) => `${d.name} ${gib(d.bytes)}`).join(', ')
    );
  }

  findings.add({
    id: free < ERROR_BYTES ? 'disk.exhausted' : 'disk.low',
    severity: free < ERROR_BYTES ? 'error' : 'warning',
    title: `${gib(free)} free on the disk omnitron writes to`,
    evidence,
    remedy:
      free < ERROR_BYTES
        ? 'Free space before anything else. At this level Postgres refuses writes and containers fail to start, ' +
          'and both surface as application errors that say nothing about the disk. ' +
          '`omnitron logs --clean` truncates the app logs; unused Docker volumes are the other usual holder.'
        : 'Not yet a fault, but the margin is small enough that a single image pull or log burst crosses it.',
  });
}

/**
 * The largest immediate subdirectories of `dir`, biggest first.
 *
 * The point is to name what is actually holding the space rather than the
 * component the reader would have guessed.
 */
export function biggestSubdirectories(dir: string, limit: number): Array<{ name: string; bytes: number }> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, bytes: directorySize(path.join(dir, e.name)) }))
    .filter((d) => d.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, limit);
}

/** Recursive byte total, bounded so a pathological tree cannot stall a check. */
export function directorySize(dir: string, budget = { entries: 20_000 }): number {
  let total = 0;

  // A path that is a file is worth its own size. Returning 0 instead would
  // make the `isDirectory()` filter in `biggestSubdirectories` unobservable —
  // a guard nothing could ever catch failing, which is the kind that quietly
  // stops being needed.
  try {
    const st = fs.statSync(dir);
    if (!st.isDirectory()) return st.size;
  } catch {
    return 0;
  }

  let stack: string[] = [dir];
  while (stack.length > 0 && budget.entries > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (budget.entries-- <= 0) break;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {
          // Removed between listing and stat; not worth a finding.
        }
      }
    }
  }
  return total;
}

/**
 * Whether the console is actually serving.
 *
 * Asked by fetching its root, not by reading the container's state. "A
 * container is running and its health check passes" is not the same claim as
 * "an operator can open the console", and the two came apart here today.
 *
 * The console is nginx serving a bind mount of `webapp/dist`. Deleting that
 * directory and rebuilding it — which any `rm -rf dist && pnpm build` does —
 * gives it a new inode, and the mount keeps pointing at the old one. Inside
 * the container the directory then does not exist at all and nginx answers
 * 404 to everything, while the container stays up. That ran for 1709
 * consecutive health-check failures before anything said so.
 *
 * A restart does not fix it: bind mounts are resolved when a container is
 * created, so it has to be recreated.
 */
export async function checkConsoleServing(findings: Findings, dc: IDaemonConfig): Promise<void> {
  const port = dc.httpPort ?? 9800;

  let status: number;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    status = res.status;
  } catch {
    // Nothing listening. `omnitron webapp` is opt-in and a daemon without a
    // console is a normal configuration, so this is not a finding.
    return;
  }

  if (status >= 200 && status < 400) {
    await checkConsoleProxy(findings, port);
    return;
  }

  findings.add({
    id: 'webapp.not-serving',
    severity: 'error',
    title: `The console answers ${status} on port ${port}`,
    evidence: [
      `GET http://127.0.0.1:${port}/ → ${status}`,
      'something is listening, so this is not "the console is switched off"',
      status === 404
        ? 'a 404 on the root usually means nginx cannot see the built files: a bind mount left pointing at a directory that was deleted and rebuilt'
        : 'nginx is up but not serving the application',
    ],
    remedy:
      'Rebuild and recreate: `pnpm --filter @omnitron/console build`, then ' +
      '`omnitron webapp stop && omnitron webapp start`. A restart is not enough — ' +
      'a bind mount is resolved when the container is created.',
  });
}

/**
 * Whether the console can reach the daemon THROUGH its own proxy.
 *
 * Serving the application and being able to use it are different claims, and
 * this platform has had them come apart: nginx handed out the bundle while
 * `/ws` was misconfigured, so the console loaded, could not open its event
 * stream, and reported the daemon offline. The operator saw a working page
 * telling them their platform was down.
 *
 * The proxy config is GENERATED when the container is created, so it drifts
 * exactly when the daemon's ports change and nobody recreated the container —
 * which is also when a restart will not help.
 *
 * `/api/health` is chosen because it is the one proxied path that answers
 * without credentials; a 502 or a timeout there means nginx cannot reach the
 * daemon it was pointed at, and the console's every RPC takes the same route.
 */
async function checkConsoleProxy(findings: Findings, port: number): Promise<void> {
  let status: number | null = null;
  let failure = '';
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    status = res.status;
  } catch (err) {
    failure = describeError(err);
  }

  if (status !== null && status >= 200 && status < 400) return;

  findings.add({
    id: 'webapp.proxy-unreachable',
    severity: 'error',
    title: 'The console is served, but it cannot reach the daemon through it',
    evidence: [
      `GET http://127.0.0.1:${port}/ → served`,
      status === null
        ? `GET http://127.0.0.1:${port}/api/health → ${failure}`
        : `GET http://127.0.0.1:${port}/api/health → ${status}`,
      'the console reaches the daemon over this same proxy, so every RPC it makes takes this route',
    ],
    remedy:
      'nginx is up and serving the bundle, so this is its upstream, not the container: the proxy config ' +
      'names the daemon ports and is written when the container is CREATED. Recreate it — ' +
      '`omnitron webapp stop && omnitron webapp start` — rather than restarting. If the daemon itself is ' +
      'the problem, `omnitron doctor` reports it separately as `daemon.down`; a healthy daemon plus this ' +
      'finding means the two disagree about which port to use.',
  });
}

/**
 * What the daemon answers to a caller holding no credentials, and who can
 * reach it.
 *
 * Measured rather than read off the config: the question is not "which
 * decorators say allowAnonymous" but "what does this daemon, as configured
 * and running right now, hand a stranger". Two services turned out to be
 * fully anonymous by way of the packages that declare them —
 * `Health@1.0.0` from titan-health, `OmnitronMetrics` from titan-metrics —
 * and neither appears in apps/omnitron at all, so no amount of reading this
 * repository would have found them.
 *
 * `live` / `ready` / `getPrometheusText` are anonymous on purpose: a kubelet
 * probe and a Prometheus scrape carry no token. `getSnapshot` is a different
 * matter — it returns every managed app by name with its CPU, memory and
 * status, which is the platform's inventory.
 *
 * Severity follows reachability, because that is what decides the cost. On
 * loopback this is a note; bound to an interface, the inventory of
 * everything running on the host is readable by anyone who can route to it.
 */
export async function checkAnonymousSurface(findings: Findings, dc: IDaemonConfig): Promise<void> {
  const httpPort = (dc.httpPort ?? 9800) + 1;
  const host = dc.host ?? '127.0.0.1';
  const reachableFromNetwork = host !== '127.0.0.1' && host !== 'localhost' && host !== '::1';

  /** Call a method with no Authorization header; true when it answers. */
  const answersAnonymously = async (service: string, method: string): Promise<boolean> => {
    try {
      const res = await fetch(`http://127.0.0.1:${httpPort}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service, method, input: [], id: 'doctor-anon' }),
        signal: AbortSignal.timeout(3000),
      });
      const body = (await res.json()) as { success?: boolean };
      return body?.success === true;
    } catch {
      // Unreachable is not "open" — say nothing rather than guess.
      return false;
    }
  };

  const probes: Array<{ service: string; method: string; what: string }> = [
    { service: 'OmnitronMetrics', method: 'getSnapshot', what: 'every managed app by name, with CPU, memory and status' },
    { service: 'Health@1.0.0', method: 'listIndicators', what: 'the health indicators this daemon runs' },
  ];

  const open: string[] = [];
  for (const probe of probes) {
    if (await answersAnonymously(probe.service, probe.method)) {
      open.push(`${probe.service}.${probe.method}() → ${probe.what}`);
    }
  }

  if (open.length === 0) return;

  findings.add({
    id: 'auth.anonymous-surface',
    severity: reachableFromNetwork ? 'warning' : 'info',
    title: reachableFromNetwork
      ? `${open.length} RPC method(s) answer without credentials, on a daemon bound to ${host}`
      : `${open.length} RPC method(s) answer without credentials (loopback only)`,
    evidence: [
      ...open,
      `daemon.host: ${host}`,
      reachableFromNetwork
        ? 'anything that can route to this host can read the above'
        : 'only processes on this machine can reach it',
    ],
    ...(reachableFromNetwork
      ? {
          remedy:
            'Set `daemon.host` back to 127.0.0.1 and reach the daemon through a proxy that authenticates, ' +
            'or accept the exposure deliberately. These methods are declared allowAnonymous in titan-metrics ' +
            'and titan-health, so the daemon cannot gate them on its own.',
        }
      : {}),
  });
}

/**
 * A container whose published ports the host cannot actually reach.
 *
 * Docker's `running` is a statement about the container, and its healthcheck
 * runs INSIDE it — both can pass while the host-side publishing is gone. That
 * combination is not hypothetical here: a forced network disconnect leaves
 * the daemon's port forwarding broken in a way that reconnecting the network
 * does not repair, so the container reports running, attached and healthy
 * while every connection from the host is refused. It cost this project a
 * day, diagnosed at the time as an application fault.
 *
 * The reading depends on the healthcheck, which is why it is used here rather
 * than only for `infra.unhealthy`: a HEALTHY container the host cannot reach
 * says the break is outside the container, and recreating is the fix. Without
 * a healthcheck the same evidence is ambiguous — the process inside may
 * simply not be listening — so the finding says so instead of guessing.
 */
export async function checkPublishedPorts(
  findings: Findings,
  c: import('../infrastructure/types.js').ContainerState
): Promise<void> {
  const ports = Object.entries(c.ports ?? {}).filter(([spec]) => spec.endsWith('/tcp'));
  if (ports.length === 0) return;

  // A container still coming up has not bound anything yet, and saying so
  // would be reporting on the clock rather than on the container.
  if (c.health === 'starting') return;
  const startedMs = c.startedAt ? Date.parse(c.startedAt) : NaN;
  if (Number.isFinite(startedMs) && Date.now() - startedMs < CONTAINER_SETTLE_MS) return;

  const unreachable: number[] = [];
  for (const [, hostPort] of ports) {
    if (!(await tcpReachable(hostPort))) unreachable.push(hostPort);
  }
  if (unreachable.length === 0) return;

  const healthy = c.health === 'healthy';
  findings.add({
    id: 'infra.port-unreachable',
    severity: healthy ? 'error' : 'warning',
    title: `Container "${c.name}" publishes ${unreachable.join(', ')} but the host cannot connect`,
    evidence: [
      `status: running${c.health && c.health !== 'none' ? `, health: ${c.health}` : ''}`,
      `published: ${ports.map(([spec, hp]) => `${spec} -> ${hp}`).join(', ')}`,
      `TCP connect to 127.0.0.1:${unreachable.join(', 127.0.0.1:')} refused or timed out`,
    ],
    remedy: healthy
      ? `Its own healthcheck passes inside the container, so the service is running and the publishing is what broke. ` +
        `Recreate it — \`docker rm -f ${c.name}\` then \`omnitron up\`. Restarting is not enough: the forwarding is ` +
        `established when the container is created.`
      : `Either the process inside never bound the port, or the host-side publishing is broken. ` +
        `\`omnitron infra logs ${c.name}\` distinguishes them: a listening service with an unreachable port is the second case, ` +
        `and is fixed by recreating the container rather than restarting it.`,
  });
}

/** Infrastructure containers the daemon manages. */
async function checkInfrastructure(findings: Findings, client: ReturnType<typeof createDaemonClient>): Promise<void> {
  try {
    const infra = await client.service<import('../shared/dto/services.js').IOmnitronInfraService>('OmnitronInfra');
    const containers = await infra.listContainers();
    if (!Array.isArray(containers)) return;

    for (const c of containers) {
      if (c.status === 'running') {
        if (c.health === 'unhealthy') {
          findings.add({
            id: 'infra.unhealthy',
            severity: 'warning',
            title: `Container "${c.name}" is running but unhealthy`,
            evidence: [`image: ${c.image}`, `health: ${c.health}`],
            remedy: `Check its logs — the daemon will recreate it after repeated failures.`,
          });
        }
        // A running container detached from every network still reports
        // "running" while publishing no ports — the failure mode the
        // phantom-endpoint janitor used to CAUSE.
        if (c.networkAttached === false) {
          findings.add({
            id: 'infra.detached',
            severity: 'error',
            title: `Container "${c.name}" is running but attached to no network`,
            evidence: ['its published ports are unreachable while detached'],
            remedy: 'Recreate it — a detached container cannot be reattached in place.',
          });
        } else {
          // Only when the container is attached: a detached one is already
          // reported above, and probing its ports would name the same cause
          // twice.
          await checkPublishedPorts(findings, c);
        }
        continue;
      }

      // A container that was created and never started is a different fault
      // from one that ran and exited, and Docker knows which: `created` with
      // a non-zero exit code means the start itself was refused, and the
      // reason — a port already bound, an image that will not run — is in
      // `error`. Recreating is what fixes that; `omnitron up` will not,
      // because the husk still holds the name.
      const neverStarted = c.status === 'created';
      findings.add({
        id: neverStarted ? 'infra.start-refused' : 'infra.not-running',
        severity: 'warning',
        title: neverStarted
          ? `Container "${c.name}" was created but never started`
          : `Container "${c.name}" is ${c.status}`,
        evidence: [`image: ${c.image}`, ...(c.error ? [`reason: ${c.error}`] : [])],
        remedy: neverStarted
          ? `Remove it and let the daemon recreate it: \`docker rm -f ${c.name}\`, then \`omnitron up\`. ` +
            `A container in this state keeps its name, so the next attempt fails the same way until it is gone.`
          : 'Run `omnitron up` to reconcile infrastructure.',
      });
    }
  } catch {
    // Infrastructure is optional; its absence is not a fault.
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function describeError(err: unknown): string {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  const e = err as { message?: string; errors?: Array<{ message?: string; code?: string }>; code?: string };

  // A failed pg connection throws an AggregateError whose own `message` is
  // EMPTY — the reason hides in `errors[]`. Logging `err.message` there
  // prints nothing at all, which is how a dead database looked like a
  // blank line in the logs.
  if (Array.isArray(e.errors) && e.errors.length > 0) {
    const inner = e.errors.map((x) => x.message || x.code).filter(Boolean).join('; ');
    if (inner) return e.code ? `${inner} (${e.code})` : inner;
  }
  if (e.message) return e.code ? `${e.message} (${e.code})` : e.message;
  return e.code ?? 'unknown error';
}

function severityMark(severity: FindingSeverity): string {
  if (severity === 'error') return prism.red('[x]');
  if (severity === 'warning') return prism.yellow('[!]');
  return prism.cyan('[i]');
}

function render(findings: Findings): void {
  const items = findings.all();

  if (items.length === 0) {
    box(prism.green('[+] No problems found.'), 'Diagnostics');
    return;
  }

  const lines: string[] = [];
  for (const [index, finding] of items.entries()) {
    if (index > 0) lines.push('');
    lines.push(`${severityMark(finding.severity)} ${prism.bold(finding.title)}`);
    for (const line of finding.evidence) lines.push(prism.dim(`      ${line}`));
    if (finding.remedy) lines.push(`      ${prism.cyan('→')} ${finding.remedy}`);
  }

  box(lines.join('\n'), 'Diagnostics');
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function doctorCommand(): Promise<void> {
  const findings = new Findings();
  const client = createDaemonClient();

  const daemonUp = await client.isReachable();

  /**
   * When the daemon started, in wall-clock ms — needed to tell whether it
   * predates the build on disk. Null when the daemon is not answering, which
   * the freshness check treats as "cannot tell" rather than "no".
   */
  let daemonStartedMs: number | null = null;

  if (!daemonUp) {
    findings.add({
      id: 'daemon.down',
      severity: 'error',
      title: 'The daemon is not running',
      evidence: ['no response on the control socket'],
      remedy: 'Start it with `omnitron up`.',
    });
  } else {
    // One `list` serves several checks, and how long it takes is itself a
    // reading: the call walks every supervisor, so a supervisor that has
    // stopped answering shows up here as latency long before it shows up as
    // a status.
    let apps: ProcessInfoDto[] = [];
    const listStarted = Date.now();
    try {
      apps = await client.list();
    } catch {
      // `checkApps` will report the failure with its own evidence.
    }
    const listMs = Date.now() - listStarted;

    if (listMs > SLOW_DAEMON_MS) {
      findings.add({
        id: 'daemon.slow',
        severity: 'warning',
        title: `The daemon took ${(listMs / 1000).toFixed(1)}s to list ${apps.length} app(s)`,
        evidence: [
          `expected well under ${SLOW_DAEMON_MS / 1000}s`,
          'the call polls every supervisor, so one that has stopped answering shows up as latency here',
        ],
        remedy:
          'Find the app whose supervisor is blocked: `omnitron inspect <app>` on each in turn will hang on the one at fault.',
      });
    }

    try {
      const status = await client.status();
      if (typeof status.uptime === 'number' && status.uptime > 0) {
        daemonStartedMs = Date.now() - status.uptime;
      }
    } catch {
      // Left null; the freshness check reports "cannot tell", not "fine".
    }

    // Each check is independent: one failing must not hide the others, which
    // is the whole point of running them together.
    for (const check of [
      () => checkDaemon(findings, client),
      () => checkApps(findings, client, apps),
      () => checkAppInternals(findings, apps),
      () => checkPorts(findings, apps),
      () => checkInfrastructure(findings, client),
      () => checkAnonymousSurface(findings, DEFAULT_DAEMON_CONFIG),
      () => checkConsoleServing(findings, DEFAULT_DAEMON_CONFIG),
    ]) {
      try {
        await check();
      } catch (err) {
        findings.add({
          id: 'doctor.check-failed',
          severity: 'warning',
          title: 'A diagnostic check could not complete',
          evidence: [describeError(err)],
        });
      }
    }
  }

  // Runs whether or not the daemon answered: a full disk is a plausible
  // reason the daemon is down, and it is the reason operators reach for last.
  try {
    await checkDiskSpace(findings);
  } catch (err) {
    findings.add({
      id: 'doctor.check-failed',
      severity: 'warning',
      title: 'The disk-space check could not complete',
      evidence: [describeError(err)],
    });
  }

  // Runs whether or not the daemon answered: a stale build is worth knowing
  // about even when the daemon is down, and it is a plausible reason it is.
  try {
    await checkBuildFreshness(findings, daemonStartedMs);
  } catch (err) {
    findings.add({
      id: 'doctor.check-failed',
      severity: 'warning',
      title: 'The build-freshness check could not complete',
      evidence: [describeError(err)],
    });
  }

  // The database is checked directly rather than through the daemon: when the
  // schema is missing the daemon still answers RPCs perfectly well, which is
  // exactly why the outage went unnoticed.
  try {
    await checkDatabase(findings);
  } catch (err) {
    findings.add({
      id: 'doctor.check-failed',
      severity: 'warning',
      title: 'The database check could not complete',
      evidence: [describeError(err)],
    });
  }

  await client.disconnect().catch(() => undefined);

  const items = findings.all();

  if (isJsonMode()) {
    emitJson({
      ok: items.length === 0,
      worst: findings.worst,
      findings: items,
    });
  } else {
    render(findings);
    const errors = items.filter((f) => f.severity === 'error').length;
    if (errors > 0) log.error(`${errors} problem(s) need attention.`);
  }

  // Non-zero exit on errors so `omnitron doctor` works as a CI gate.
  if (items.some((f) => f.severity === 'error')) {
    process.exitCode = 1;
  }
}
