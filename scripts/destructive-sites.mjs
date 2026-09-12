#!/usr/bin/env node
/**
 * Every place omnitron destroys something, and what bounds the target set.
 *
 * The daemon kills processes, removes containers, deletes files and drops
 * rows. Four defects found on 2026-09-12 shared one shape: a destructive path
 * read ABSENCE as permission.
 *
 *   - `ProcessJanitor.coldStartSweep` asked "is this parented by ME?" and
 *     reaped every fork-worker of the live stand whenever anything else
 *     constructed an orchestrator — one unit test did.
 *   - `daemonStop`/`daemonKill` asked "is SOMETHING alive at this pid?" and
 *     would SIGKILL whatever inherited a recycled pid.
 *   - `reconcileOrphanContainers` asked "is this in my expected set?" while
 *     computing that set from configs it had not loaded, so the set was
 *     empty and every running infra container qualified as an orphan.
 *   - the MinIO backup interpolated a secret into a `/bin/sh -c` string.
 *
 * In each case the safe rule already existed a few lines away, so another
 * heuristic would not have helped. What helps is a LIST somebody has to
 * answer for: every destructive site below is named with what bounds it, and
 * a NEW one fails this scan until its line is written.
 *
 * WHAT IT REPORTS: a call to a destroying API inside `apps/omnitron/src`,
 * keyed `<file>::<enclosing function>`. A site absent from EXPECTED is the
 * finding; an EXPECTED line with no site behind it any more is also a
 * finding, because a stale claim is worse than no claim.
 *
 * THE QUESTIONS TO ANSWER for a new one, in this order:
 *   1. What names the target — an id the caller passed, or a set this code
 *      computed?
 *   2. If computed: what happens when it comes back EMPTY? "Everything
 *      qualifies" is the bug. "Do nothing" is the answer.
 *   3. Can another process legitimately own the same thing? Then identity,
 *      not liveness or absence, has to decide. A pid is alive is not a pid
 *      is ours.
 *
 * TRIAGE, 2026-09-12: 63 raw matches → 60 real sites, all reviewed below.
 * Three were the scanner reading a declaration as a call (see `isCall`).
 * Everything that removes more than one thing at a time is driven either by
 * the `omnitron.managed` container label, by `desiredContainers` (this
 * daemon's own config), or by a retention cutoff with an explicit LIMIT.
 *
 * Usage: node scripts/destructive-sites.mjs
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/** Calls that end something. */
const DESTROYERS = [
  /\bprocess\.kill\s*\(/,
  /\.kill\s*\(\s*['"]SIG/,
  /\bremoveContainer\s*\(/,
  /\bstopContainer\s*\(/,
  /\brmSync\s*\(/,
  /\bunlinkSync\s*\(/,
  /\bdeleteFrom\s*\(/,
  /DELETE\s+FROM/i,
  /rm\s+-rf/,
];

/**
 * Every destructive site, with what bounds its target set.
 *
 * A line here is a claim somebody checked by reading the code. Adding one
 * without reading is the only way this file can lie.
 */
const EXPECTED = {
  // ---- processes -----------------------------------------------------------
  'commands/daemon-cmd.ts::daemonStop':
    'the daemon pid from PidManager.getPid() (alive AND argv matches); re-validated by getPid() before the SIGKILL 20s later',
  'commands/daemon-cmd.ts::daemonKill':
    'same — a pid whose argv no longer matches is cleaned up, not signalled',
  'commands/stop.ts::stopCommand':
    'same; the SIGKILL after the 10s grace re-reads getPid() rather than trusting liveness',
  'orchestrator/process-janitor.ts::reap':
    'pids from a sweep; both sweeps require the parent to be dead OR to be this process (fixed 2026-09-12)',
  'orchestrator/orchestrator.service.ts::stopChildProcess':
    "this handle's own ChildProcess and its process group; the SIGKILL timer is cleared on 'exit'",
  'infrastructure/phantom-endpoint-janitor.ts::runDocker':
    'the `docker` child it just spawned, on a 10s timeout',
  'services/backup-pipeline.ts::dumpToFile':
    'its own pg_dump child, on timeout',
  'services/backup-pipeline.ts::restoreFromFile':
    'its own psql child, on timeout',
  'services/pipeline.service.ts::runShellCommand':
    'its own step child, on timeout',
  'services/kubernetes.service.ts::portForward':
    'its own kubectl child, when the caller closes the forward',

  // ---- containers ----------------------------------------------------------
  // Two label-wide sweeps exist (`infra down`, orphan reconcile) and both are
  // bounded by `omnitron.managed`; everything else names one container.
  'commands/infra.ts::infraDownCommand':
    'listManagedContainers() — the omnitron.managed label; empty list returns early ("No Omnitron-managed containers running")',
  'commands/up.ts::provisionOmnitronPg':
    'the one stack-prefixed pg container it is about to recreate, by name',
  'daemon/daemon.ts::startInfrastructure':
    'same, by name',
  'daemon/daemon.ts::reconcileOrphanContainers':
    'omnitron.managed containers outside the expected stack prefixes — and it ABORTS when that expected set is incomplete (fixed 2026-09-12)',
  'daemon/daemon.ts::registerShutdownTasks':
    "the literal 'omnitron-nginx' this daemon started",
  'webapp/webapp.service.ts::start':
    "the literal 'omnitron-nginx', before recreating it",
  'webapp/webapp.service.ts::stop':
    "the literal 'omnitron-nginx'",
  'infrastructure/infrastructure.service.ts::provision':
    'the stale stack-prefixed pg container, by name, only when the global omnitron-pg owns the port',
  'infrastructure/infrastructure.service.ts::teardown':
    'this.desiredContainers — the set this service built from config; empty means nothing is removed',
  'infrastructure/infrastructure.service.ts::reconcileServiceLocked':
    'one container: the desired spec being reconciled, or the id computeAction returned for it',
  'infrastructure/infrastructure.service.ts::healthSweep':
    'one desired service, after UNHEALTHY_RESTART_THRESHOLD consecutive unhealthy ticks',
  'infrastructure/container-runtime.ts::stopContainer':
    'the primitive — takes a name or id from its caller',
  'infrastructure/container-runtime.ts::removeContainer':
    'the primitive — takes a name or id from its caller',
  'services/infrastructure.rpc-service.ts::stopContainer':
    'assertManaged() first: the name must appear in listManagedContainers(), and the caller must hold OPERATOR_ROLES',
  'services/infrastructure.rpc-service.ts::removeContainer':
    'same — assertManaged() + OPERATOR_ROLES',
  'mcp/tool-groups/infra.tools.ts::createInfraTools':
    'goes through InfrastructureRpcService, so assertManaged() applies to MCP callers too',

  // ---- files ---------------------------------------------------------------
  'daemon/pid-manager.ts::remove':
    'this pidfile',
  'daemon/pid-manager.ts::cleanupStale':
    'this pidfile and the socket passed in, only once isRunning() says the pid is dead or a stranger',
  'daemon/state-store.ts::init':
    'the one legacy json file it has just imported into sqlite',
  'commands/daemon-cmd.ts::daemonKill (socket)':
    'the daemon socket path, after the daemon is confirmed gone',
  'commands/service.ts::serviceUninstall':
    'the launchd plist / systemd unit this installer wrote; returns early when not installed',
  'monitoring/log-manager.ts::rotateLog':
    'the oldest rotation slot (.{maxFiles-1}) of one app, immediately before the shift overwrites it',
  'monitoring/log-manager.ts::compressFile':
    'the file it has just gzipped',
  'orchestrator/bootstrap-loader.ts::loadBootstrapConfig':
    'the temp file esbuild wrote for this import',
  'project/artifact-builder.ts::cleanOldArtifacts':
    'artifacts past `keep` (default 3) per app, newest first',
  'project/registry.ts::migrateLegacyJsonIfPresent':
    'the one legacy registry file it has just imported',
  'services/node-manager.service.ts::load':
    'the one legacy nodes.json it has just imported',
  'services/backup.service.ts::migrateLegacyMetaIfPresent':
    'a legacy metadata file it has just indexed into sqlite',
  'services/backup.service.ts::createBackup':
    'the output file of a backup that threw',
  'services/backup.service.ts::execToFile':
    'the output file of a backup that produced nothing',
  'services/backup.service.ts::deleteBackup':
    'one backup file, named by the row the caller asked for',
  'services/backup.service.ts::restoreStorageBackup':
    'a staging dir under backupDir named by a fresh uuid, plus /tmp/_bk_storage INSIDE the minio container',
  'services/backup.service.ts::createStorageBackup':
    'the same two, same shapes',

  // ---- rows ----------------------------------------------------------------
  'daemon/daemon-state-store.service.ts::kvDeleteSync':
    'one key',
  'daemon/daemon-state-store.service.ts::kvDelete':
    'one key',
  'daemon/daemon-state-store.service.ts::deleteProjectSync':
    'one project by name',
  'daemon/daemon-state-store.service.ts::deleteBackupSync':
    'one backup by id',
  'daemon/daemon-state-store.service.ts::deleteNodeSync':
    'one node by id',
  'services/alert.service.ts::deleteRule':
    'one rule by id',
  'services/fleet.service.ts::removeNode':
    'one node by id',
  'services/pipeline.service.ts::deletePipeline':
    'one pipeline and its runs, by id',
  'services/auth.service.ts::signOut':
    'one session by id',
  'services/auth.service.ts::validateSession':
    'the one session it just read and found expired',
  'services/auth.service.ts::refreshSession':
    'the one session it just read and found past the 5-minute grace',
  'services/auth.service.ts::changePassword':
    "one user's sessions, optionally excluding the caller's current one",
  'services/auth.service.ts::cleanupExpiredSessions':
    'sessions past their expiry',
  'services/log-collector.service.ts::pruneOldLogs':
    'rows past the retention cutoff, selected by id in batches of plan.batchSize, capped at batchesPerPass',
  'services/sync.service.ts::enforceBufferBounds':
    'synced rows past retention, then an eviction plan by explicit id (warns when undelivered rows are dropped)',
  'workers/health-monitor.service.ts::cleanupOldRows':
    'health checks past retentionDays, LIMIT 10000 per pass',
};

const strip = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(Math.max(0, m.length - p1.length)));

const METHOD = /^\s{2,4}(?:public\s+|private\s+|protected\s+|static\s+|override\s+|abstract\s+|async\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/;
const FUNCTION = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
const NOT_A_METHOD = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'constructor']);

/**
 * Is this line a function/method HEADER, rather than a call that happens to
 * sit at method indentation?
 *
 * Without this, `  serviceBootout();` inside a top-level function reads as a
 * method declaration and every later site in the file is attributed to it —
 * which is how the first run of this scan named three functions that do not
 * contain the code it was pointing at.
 */
function isDeclaration(line) {
  if (/;\s*$/.test(line)) return false; // a call, or an interface member
  if (/\{\s*$/.test(line)) return true; // ...) {  /  ...): T {
  const open = (line.match(/\(/g) ?? []).length;
  const close = (line.match(/\)/g) ?? []).length;
  return open > close; // signature continues on the next line
}

/**
 * Is this destroyer match a CALL, and not the declaration of the function
 * that bears the same name? `export async function removeContainer(…)` and
 * the interface member `removeContainer(nameOrId: string): Promise<void>;`
 * both contain `removeContainer(` and destroy nothing by themselves.
 */
function isCall(line) {
  // `.*` inside the parens on purpose: a member's parameter object can itself
  // contain `;` — `stopContainer(data: { name: string; timeout?: number }): …`
  // is what slipped through a `[^;]*` version of this.
  if (/^\s*(?:readonly\s+)?[A-Za-z_$][\w$]*\s*(?:<[^>]*>)?\s*\(.*\)\s*:\s*.+;\s*$/.test(line)) return false;
  return !isDeclaration(line);
}

/** Site keys found in one file's source. */
export function sitesIn(relPath, source) {
  const lines = strip(source).split('\n');
  const found = new Set();
  let enclosing = '(top level)';
  lines.forEach((line) => {
    const m = METHOD.exec(line) ?? FUNCTION.exec(line);
    if (m && !NOT_A_METHOD.has(m[1]) && isDeclaration(line)) enclosing = m[1];
    if (DESTROYERS.some((re) => re.test(line)) && isCall(line)) found.add(`${relPath}::${enclosing}`);
  });
  return [...found];
}

// --- self-check ------------------------------------------------------------
{
  const fixture = `
class Thing {
  async safeRead(): Promise<void> {
    await this.db.selectFrom('logs').execute();
  }

  async removeIt(id: string): Promise<void> {
    await this.db.deleteFrom('logs').where('id', '=', id).execute();
  }

  async killIt(pid: number): Promise<void> {
    process.kill(pid, 'SIGKILL');
  }
}
`;
  const commented = `
class Thing {
  async mentionsOnly(): Promise<void> {
    // this used to call process.kill(pid) and deleteFrom('logs')
    await this.nothing();
  }
}
`;
  // The two shapes that made the first run lie: a bare declaration counted as
  // a call, and a 2-space-indented call counted as a declaration.
  const declarations = `
export interface Runtime {
  removeContainer(nameOrId: string): Promise<void>;
  stopContainer(data: { name: string; timeout?: number }): Promise<{ ok: boolean }>;
}
export async function removeContainer(nameOrId: string): Promise<void> {
  await adapter.removeContainer(nameOrId, true);
}
`;
  const indentedCall = `
export async function uninstall(): Promise<void> {
  bootout();
  fs.rmSync(plistPath(), { force: true });
}
`;
  const got = sitesIn('x.ts', fixture);
  const bad = [];
  if (!got.includes('x.ts::removeIt')) bad.push('missed a row delete');
  if (!got.includes('x.ts::killIt')) bad.push('missed a process kill');
  if (got.includes('x.ts::safeRead')) bad.push('reported a plain read');
  if (sitesIn('y.ts', commented).length !== 0) bad.push('reported a destroyer named in a comment');

  const decl = sitesIn('z.ts', declarations);
  if (decl.length !== 1 || decl[0] !== 'z.ts::removeContainer') {
    bad.push(`declarations: expected only the inner call, got ${JSON.stringify(decl)}`);
  }
  const indented = sitesIn('w.ts', indentedCall);
  if (indented.length !== 1 || indented[0] !== 'w.ts::uninstall') {
    bad.push(`indented call: expected w.ts::uninstall, got ${JSON.stringify(indented)}`);
  }
  if (bad.length) { console.error('SELF-CHECK FAILED: ' + bad.join('; ')); process.exit(2); }
}

const files = execSync("git ls-files 'apps/omnitron/src/**/*.ts'", { encoding: 'utf8', timeout: 60_000 })
  .trim().split('\n').filter(Boolean)
  .filter((f) => !/\.(test|spec)\.ts$/.test(f));

const seen = new Set();
for (const f of files) {
  const rel = f.replace('apps/omnitron/src/', '');
  for (const site of sitesIn(rel, readFileSync(f, 'utf8'))) seen.add(site);
}

// One site is listed under a suffixed key because two different things are
// destroyed in the same function and they are bounded by different rules.
const ALIASED = { 'commands/daemon-cmd.ts::daemonKill (socket)': 'commands/daemon-cmd.ts::daemonKill' };
const reviewed = new Set(Object.keys(EXPECTED).map((k) => ALIASED[k] ?? k));

const unreviewed = [...seen].filter((s) => !reviewed.has(s)).sort();
const stale = [...reviewed].filter((s) => !seen.has(s)).sort();

console.log(`${seen.size} destructive site(s) in apps/omnitron/src; ${reviewed.size} reviewed\n`);

if (unreviewed.length) {
  console.log('=== NOT REVIEWED — answer the three questions above, then add a line to EXPECTED ===');
  for (const s of unreviewed) console.log(`  ${s}`);
  console.log('');
}
if (stale.length) {
  console.log('=== REVIEWED BUT GONE — remove these lines, they no longer describe the code ===');
  for (const s of stale) console.log(`  ${s}`);
  console.log('');
}

console.log(
  'self-check OK: sees a row delete and a process kill; ignores a plain read, a destroyer named in a\n' +
  'comment, an interface member and a function declaring its own name; attributes a 2-space-indented\n' +
  'call to the function around it',
);
if (unreviewed.length || stale.length) process.exit(1);
