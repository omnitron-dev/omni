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

    // The tables whose absence produced the log storm. Checked by name rather
    // than inferred from bookkeeping: a database can carry migration rows and
    // still be missing tables if someone dropped them.
    const required = ['alert_rules', 'omnitron_sessions', 'logs', 'metrics_raw', 'nodes'];
    const missing = required.filter((t) => !present.has(t));
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
 * An app that answers `online` while nothing is listening on its port.
 *
 * The supervisor's notion of "online" is that the process exists. Whether it
 * ever finished binding is a different question, and the one an operator is
 * actually asking when a request fails.
 */
export async function checkPorts(findings: Findings, apps: ProcessInfoDto[]): Promise<void> {
  const net = await import('node:net');

  const reachable = (port: number): Promise<boolean> =>
    new Promise((resolve) => {
      const socket = new net.Socket();
      const done = (ok: boolean) => {
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(1_000);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
      socket.connect(port, '127.0.0.1');
    });

  for (const app of apps) {
    if (app.status !== 'online' || app.port === null) continue;
    if (await reachable(app.port)) continue;

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
