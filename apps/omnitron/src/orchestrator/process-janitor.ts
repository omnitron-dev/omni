/**
 * ProcessJanitor — kills leaked fork-worker processes.
 *
 * The leak: when an app restart sequence partially fails (esbuild
 * rebuild failure, supervisor mid-spawn crash), the children spawned
 * by an earlier attempt can survive the cleanup path. The orchestrator
 * loses its reference to them; from its perspective the app is in
 * `errored` state with no children. From the OS's perspective there
 * are still `fork-worker.js` processes alive, holding sockets and DB
 * connections.
 *
 * The janitor is the safety net. It does NOT replace correct cleanup
 * in process-spawner / supervisor; it catches what slips through.
 *
 * Algorithm (every `intervalMs`, default 30s):
 *   1. Walk `ps` for every running `fork-worker.js` process.
 *   2. Build the set of PIDs the orchestrator currently owns by
 *      iterating every handle's supervisor children.
 *   3. Any fork-worker PID NOT in the owned set is an orphan:
 *      - if its ppid points at a non-existent process (init parent
 *        adopted), the parent daemon died; kill it (cold-start case).
 *      - if its ppid is THIS daemon but it's not in the owned set,
 *        we lost it during a restart cycle; kill it.
 *   4. SIGTERM first, then SIGKILL after `gracefulMs`.
 *
 * Cold-start mode: on daemon boot, before any apps register, do a
 * single scan and kill every fork-worker whose ppid is NOT this
 * daemon's PID. They belong to a previous daemon that's now dead.
 */

import { execSync } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import { isProcessAlive } from '@omnitron-dev/titan/utils';

export interface ProcessJanitorOptions {
  /** Interval between sweeps. Default 30s. */
  readonly intervalMs?: number;
  /** Grace period after SIGTERM before SIGKILL. Default 3s. */
  readonly gracefulMs?: number;
  /**
   * Minimum age (seconds) before a process can be classified as
   * orphan. Protects newly-spawned fork-workers from being reaped
   * during their startup window — supervisor.getChildNames() doesn't
   * report a child until `supervisor.start()` resolves, and that can
   * take 5–30s for apps that connect to DB/Redis/blockchain RPCs.
   * Without this guard, the janitor would race and kill perfectly
   * legitimate workers.
   *
   * Default 60s — safe envelope for slow init paths.
   */
  readonly minProcessAgeSeconds?: number;
  /** Logger for diagnostics. */
  readonly logger?: ILogger;
  /**
   * Returns the set of OS pids the orchestrator considers owned.
   * The janitor calls this each sweep — must be cheap.
   */
  readonly getOwnedPids: () => ReadonlySet<number>;
  /**
   * Optional metric sink. The reaper calls this on each sweep so a
   * Prometheus exporter (C10) can plot orphan counts.
   */
  readonly onMetrics?: (m: JanitorSweepMetrics) => void;
  /**
   * Override for the process listing (tests). Real implementation
   * shells out to `ps -eo pid,ppid,args` and filters for fork-worker
   * paths.
   */
  readonly listProcesses?: () => readonly PsRow[];
  /**
   * Override for the liveness probe (tests). Real implementation
   * uses `process.kill(pid, 0)`.
   */
  readonly isAlive?: (pid: number) => boolean;
}

export interface PsRow {
  readonly pid: number;
  readonly ppid: number;
  readonly command: string;
  /** Seconds since process started (etimes from ps). 0 if unknown. */
  readonly elapsedSeconds: number;
}

export interface JanitorSweepMetrics {
  readonly scannedAt: Date;
  readonly forkWorkersAlive: number;
  readonly ownedPids: number;
  readonly orphansFound: number;
  readonly orphansKilled: number;
  readonly killErrors: number;
}

export class ProcessJanitor {
  private readonly intervalMs: number;
  private readonly gracefulMs: number;
  private readonly minProcessAgeSeconds: number;
  private readonly logger: ILogger | undefined;
  private readonly onMetrics: ((m: JanitorSweepMetrics) => void) | undefined;
  private readonly getOwnedPids: () => ReadonlySet<number>;
  private readonly listProcesses: () => readonly PsRow[];
  private readonly isAlive: (pid: number) => boolean;

  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;

  constructor(options: ProcessJanitorOptions) {
    this.intervalMs = options.intervalMs ?? 30_000;
    this.gracefulMs = options.gracefulMs ?? 3_000;
    this.minProcessAgeSeconds = options.minProcessAgeSeconds ?? 60;
    this.logger = options.logger;
    this.onMetrics = options.onMetrics;
    this.getOwnedPids = options.getOwnedPids;
    this.listProcesses = options.listProcesses ?? (() => listForkWorkersFromPs(this.logger));
    this.isAlive = options.isAlive ?? defaultIsAlive;
  }

  /**
   * Cold-start sweep — call BEFORE any apps register. Kills every
   * `fork-worker.js` whose ppid is not the current daemon (i.e.
   * adopted by init after a previous daemon died).
   *
   * Synchronous-feeling — uses SIGTERM then waits a fixed grace
   * before SIGKILL. Returns the count of processes reaped.
   */
  async coldStartSweep(): Promise<number> {
    const myPid = process.pid;
    const all = this.listProcesses();
    const stale = all.filter((row) => row.ppid !== myPid);

    if (stale.length === 0) {
      this.logger?.debug?.({ scanned: all.length }, 'janitor: cold start — no stale fork-workers');
      return 0;
    }
    this.logger?.warn?.(
      { count: stale.length, pids: stale.slice(0, 10).map((r) => r.pid) },
      'janitor: cold start — reaping stale fork-workers from a previous daemon',
    );
    return this.reap(stale.map((r) => r.pid));
  }

  /** Begin periodic sweeps. Idempotent. */
  start(): void {
    if (this.timer) return;
    const sweep = async () => {
      if (this.inFlight) return;
      this.inFlight = true;
      try {
        await this.runSweep();
      } catch (err) {
        this.logger?.error?.({ err }, 'janitor: sweep failed');
      } finally {
        this.inFlight = false;
      }
    };
    this.timer = setInterval(() => {
      void sweep();
    }, this.intervalMs);
    // Don't keep the daemon alive on the timer alone.
    this.timer.unref();
  }

  /** Stop periodic sweeps. Idempotent. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Run one sweep on demand. Useful for tests and manual triggering. */
  async runSweep(): Promise<JanitorSweepMetrics> {
    const owned = this.getOwnedPids();
    const all = this.listProcesses();
    const myPid = process.pid;

    const orphans = all.filter((row) => {
      // Owned by the orchestrator → not an orphan.
      if (owned.has(row.pid)) return false;
      // Newly-spawned workers that haven't yet finished startup are
      // NOT yet in supervisor.getChildNames() — guard them with a
      // minimum-age threshold so the janitor doesn't kill them in
      // mid-init.
      if (row.elapsedSeconds < this.minProcessAgeSeconds) return false;
      // Process whose parent is THIS daemon, but the daemon doesn't
      // claim it → orphan from a partial restart.
      if (row.ppid === myPid) return true;
      // Process adopted by init (parent is gone) → orphan from a
      // previous daemon that died. Reap it.
      if (!this.isAlive(row.ppid)) return true;
      // Some other parent — not ours, leave alone.
      return false;
    });

    let killed = 0;
    let killErrors = 0;
    if (orphans.length > 0) {
      this.logger?.warn?.(
        { count: orphans.length, pids: orphans.slice(0, 10).map((r) => r.pid) },
        'janitor: orphan fork-workers detected',
      );
      const result = await this.reap(orphans.map((r) => r.pid));
      killed = result;
      killErrors = orphans.length - result;
    }

    const metrics: JanitorSweepMetrics = {
      scannedAt: new Date(),
      forkWorkersAlive: all.length,
      ownedPids: owned.size,
      orphansFound: orphans.length,
      orphansKilled: killed,
      killErrors,
    };
    this.onMetrics?.(metrics);
    return metrics;
  }

  /**
   * SIGTERM all pids → wait `gracefulMs` → SIGKILL any survivor.
   * Returns the number of pids successfully terminated (including
   * those killed forcefully).
   */
  private async reap(pids: number[]): Promise<number> {
    let success = 0;
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'ESRCH') {
          // Already gone — count as success.
          success += 1;
        } else {
          this.logger?.warn?.({ pid, err }, 'janitor: SIGTERM failed');
        }
      }
    }
    await wait(this.gracefulMs);
    for (const pid of pids) {
      if (!this.isAlive(pid)) {
        success += 1;
        continue;
      }
      try {
        process.kill(pid, 'SIGKILL');
        success += 1;
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'ESRCH') success += 1;
        else this.logger?.error?.({ pid, err }, 'janitor: SIGKILL failed');
      }
    }
    return Math.min(success, pids.length);
  }
}

// ---------------------------------------------------------------------------
// Process-table helpers (production defaults)
// ---------------------------------------------------------------------------

/**
 * Walk `ps -eo pid,ppid,etime,args` and pick rows whose command
 * path contains `titan-pm/dist/fork-worker.js`. We match on the path
 * substring rather than the basename so we don't catch unrelated
 * `fork-worker.js` files belonging to other tools.
 *
 * `etime` is the formatted elapsed-time field, available on both
 * Linux and macOS (unlike `etimes` which is Linux-only). Format:
 *   `MM:SS`            — under an hour
 *   `HH:MM:SS`         — under a day
 *   `DD-HH:MM:SS`      — multi-day
 * Parsed to seconds in `parseEtime` below — used to protect newly-
 * spawned workers from the orphan reaper while their
 * supervisor.getChildNames() is still empty.
 */
function listForkWorkersFromPs(logger?: ILogger): PsRow[] {
  let raw: string;
  try {
    raw = execSync('ps -eo pid,ppid,etime,args', { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  } catch (err) {
    logger?.warn?.({ err }, 'janitor: ps failed');
    return [];
  }
  const rows: PsRow[] = [];
  for (const line of raw.split('\n')) {
    if (!line.includes('titan-pm/dist/fork-worker.js')) continue;
    const trimmed = line.trim();
    // pid, ppid, etime (no whitespace), then args
    const match = /^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(trimmed);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const elapsedSeconds = parseEtime(match[3] ?? '0');
    const command = match[4] ?? '';
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
    // Don't include the daemon itself if it somehow matched.
    if (pid === process.pid) continue;
    rows.push({ pid, ppid, command, elapsedSeconds });
  }
  return rows;
}

/**
 * Parse ps's `etime` format → seconds.
 * Supported shapes:
 *   `SS`          — seconds (rare; some ps variants emit on first second)
 *   `MM:SS`       — minutes + seconds
 *   `HH:MM:SS`    — hours + minutes + seconds
 *   `DD-HH:MM:SS` — days + hours + minutes + seconds
 */
function parseEtime(raw: string): number {
  if (!raw) return 0;
  let days = 0;
  let rest = raw;
  const dashIdx = rest.indexOf('-');
  if (dashIdx >= 0) {
    days = Number(rest.slice(0, dashIdx)) || 0;
    rest = rest.slice(dashIdx + 1);
  }
  const parts = rest.split(':').map((p) => Number(p) || 0);
  let total = days * 86400;
  if (parts.length === 1) total += parts[0]!;
  else if (parts.length === 2) total += parts[0]! * 60 + parts[1]!;
  else if (parts.length === 3) total += parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  return total;
}

// Thin delegate to the shared helper in @omnitron-dev/titan/utils.
// Kept as a named local so `__test__` exports continue to point at
// a callable, but the actual liveness logic (EPERM-as-alive,
// invalid-pid-as-dead) lives in exactly one place across the
// monorepo now.
function defaultIsAlive(pid: number): boolean {
  return isProcessAlive(pid);
}

// Re-exported for tests — same logic without the spawning side effects.
export const __test__ = { listForkWorkersFromPs, defaultIsAlive, parseEtime };
