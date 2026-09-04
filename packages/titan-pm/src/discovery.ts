/**
 * Process discovery — cross-daemon-restart reconciliation primitive.
 *
 * After a daemon hard-restart (crash, kill -9, OS power loss recovery)
 * the in-memory handle map is empty BUT the children the previous
 * daemon spawned are still alive. Without discovery the orchestrator
 * either:
 *
 *   - calls `startApp(foo)` and races a port-bind against the live
 *     copy (the new spawn fails, the old keeps running but is now
 *     unmanaged → orphan),
 *   - or the janitor reaps the live copy as an "orphan" 60s later
 *     (sliding-window age check), losing all in-flight work.
 *
 * `discoverManagedProcesses()` walks `ps`, finds processes carrying
 * the conventional `OMNITRON_MANAGED=1` env var plus a matching
 * `OMNITRON_APP_NAME` (set by both classic-launcher and the
 * bootstrap process), and returns the metadata the orchestrator
 * needs to re-adopt them on boot. Adoption is the orchestrator's
 * responsibility — this module only DISCOVERS.
 *
 * **Platform support**: Darwin/BSD (`ps -p <pid> -E`), Linux
 * (`/proc/<pid>/environ`). Windows isn't supported yet — `ps`
 * doesn't ship there; a future addition could use `tasklist`.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isAlive } from './liveness.js';

export interface DiscoveredProcess {
  pid: number;
  ppid: number;
  /** Canonical app name from `OMNITRON_APP_NAME`. */
  appName: string;
  /** `OMNITRON_PROJECT/OMNITRON_STACK/OMNITRON_APP_NAME` when stack-mode env present. */
  fullyQualifiedName: string;
  /** `OMNITRON_MANAGED` truthiness — distinguishes ours from look-alikes. */
  managed: boolean;
  /** Raw env, useful for callers that need other tags (PORT, etc.). */
  env: Readonly<Record<string, string>>;
  /** Seconds since process started (ps `etime`). 0 when unknown. */
  elapsedSeconds: number;
}

/**
 * Find every alive Omnitron-managed process on the host. Cheap
 * enough to call on every daemon boot (one `ps` invocation + one
 * env read per match, both bounded by the small managed-process
 * count). Idempotent — never spawns, kills, or modifies state.
 */
export function discoverManagedProcesses(opts?: {
  /** Inject a fake `ps` source for tests. */
  listPids?: () => Array<{ pid: number; ppid: number; elapsedSeconds: number }>;
  /** Inject a fake env reader for tests. */
  readEnv?: (pid: number) => Record<string, string> | null;
}): DiscoveredProcess[] {
  const pids = opts?.listPids ? opts.listPids() : listAllPids();
  const readEnv = opts?.readEnv ?? defaultReadEnv;
  const out: DiscoveredProcess[] = [];
  for (const row of pids) {
    if (!isAlive(row.pid)) continue;
    const env = readEnv(row.pid);
    if (!env) continue;
    const appName = env['OMNITRON_APP_NAME'];
    if (!appName) continue;
    const project = env['OMNITRON_PROJECT'];
    const stack = env['OMNITRON_STACK'];
    const fqn = project && stack ? `${project}/${stack}/${appName}` : appName;
    out.push({
      pid: row.pid,
      ppid: row.ppid,
      appName,
      fullyQualifiedName: fqn,
      managed: env['OMNITRON_MANAGED'] === '1' || env['OMNITRON_MANAGED'] === 'true',
      env,
      elapsedSeconds: row.elapsedSeconds,
    });
  }
  return out;
}

/**
 * Read `/proc/<pid>/environ` (Linux) or shell out to `ps -p <pid> -E`
 * (Darwin/BSD). Returns null when the env can't be read (perms,
 * process exited mid-call, platform not supported).
 */
function defaultReadEnv(pid: number): Record<string, string> | null {
  // Linux fast path — /proc is a kernel filesystem so reading is
  // cheap + atomic for a single process.
  try {
    if (process.platform === 'linux') {
      const raw = readFileSync(`/proc/${pid}/environ`, 'utf-8');
      return parseEnvironZeros(raw);
    }
  } catch {
    /* fall through to ps */
  }
  // Darwin / BSD — `ps -p <pid> -E` emits "args" with env appended.
  // It's slower (process spawn per pid) so we only use it on Darwin.
  try {
    const out = execSync(`ps -p ${pid} -E -o command=`, { encoding: 'utf-8', timeout: 1000 });
    return parseEnvironSpace(out);
  } catch {
    return null;
  }
}

/** Parse `\0`-separated `KEY=VALUE` (Linux /proc/<pid>/environ format). */
function parseEnvironZeros(raw: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const entry of raw.split('\0')) {
    if (!entry) continue;
    const eq = entry.indexOf('=');
    if (eq < 0) continue;
    env[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return env;
}

/**
 * Parse `ps -E` output — command args followed by env entries
 * separated by spaces. Heuristic: the trailing tokens that match
 * `KEY=VALUE` (uppercase-or-digit key) are env; everything before
 * is the command. Imperfect (a quoted arg containing `=` confuses
 * it) but good enough for our env-tag matching.
 */
function parseEnvironSpace(raw: string): Record<string, string> {
  const env: Record<string, string> = {};
  const tokens = raw.trim().split(/\s+/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tok = tokens[i];
    if (!tok) continue;
    const eq = tok.indexOf('=');
    if (eq <= 0) break; // first non-env token — stop walking back
    const key = tok.slice(0, eq);
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) break;
    env[key] = tok.slice(eq + 1);
  }
  return env;
}

/**
 * Parse the `etime` column into seconds.
 *
 * `etime` is the *formatted* elapsed-time field, and unlike Linux-only
 * `etimes` it exists on Darwin/BSD too. Formats, widest first:
 *
 *   `DD-HH:MM:SS`  multi-day
 *   `HH:MM:SS`     under a day
 *   `MM:SS`        under an hour
 *
 * Returns 0 for anything unrecognised — callers treat elapsed time as a
 * hint, never as a correctness input.
 */
export function parseEtime(value: string): number {
  const trimmed = value.trim();
  if (trimmed === '') return 0;

  let days = 0;
  let rest = trimmed;
  const dash = rest.indexOf('-');
  if (dash > 0) {
    days = Number(rest.slice(0, dash));
    rest = rest.slice(dash + 1);
    if (!Number.isFinite(days)) return 0;
  }

  const parts = rest.split(':');
  if (parts.length < 2 || parts.length > 3) return 0;

  let seconds = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isFinite(n) || n < 0) return 0;
    seconds = seconds * 60 + n;
  }
  return days * 86_400 + seconds;
}

/** Parse the output of `ps -eo pid,ppid[,etime]`. */
export function parsePsRows(raw: string): Array<{ pid: number; ppid: number; elapsedSeconds: number }> {
  const out: Array<{ pid: number; ppid: number; elapsedSeconds: number }> = [];
  const lines = raw.split('\n');
  // Line 0 is the `PID PPID ELAPSED` header.
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
    // The elapsed column is absent when we fell back to the minimal `ps`.
    out.push({ pid, ppid, elapsedSeconds: parts[2] === undefined ? 0 : parseEtime(parts[2]) });
  }
  return out;
}

/**
 * Walk every pid on the host via `ps`.
 *
 * We ask for `etime`, NOT `etimes`: `etimes` is a procps (Linux) extension.
 * On macOS/BSD `ps -eo pid,ppid,etimes` fails outright — `ps: etimes: keyword
 * not found`, exit 1 — so `execSync` threw, the bare `catch` swallowed it, and
 * `discoverManagedProcesses()` returned an empty list on every Darwin host.
 * That is a silent total failure of cross-daemon-restart reconciliation on a
 * platform this module's own header claims to support.
 *
 * If even `etime` is unavailable (a minimal BusyBox `ps`, say) we degrade to
 * `pid,ppid` alone: discovery still works, only the age hint is lost.
 */
function listAllPids(): Array<{ pid: number; ppid: number; elapsedSeconds: number }> {
  const opts = { encoding: 'utf-8' as const, maxBuffer: 4 * 1024 * 1024 };
  try {
    return parsePsRows(execSync('ps -eo pid,ppid,etime', opts));
  } catch {
    /* fall through to the minimal form */
  }
  try {
    return parsePsRows(execSync('ps -eo pid,ppid', opts));
  } catch {
    return [];
  }
}
