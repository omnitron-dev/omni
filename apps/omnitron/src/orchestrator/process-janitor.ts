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
 * single scan and kill every fork-worker whose parent is gone — a
 * previous daemon that really is dead. A worker whose parent is ALIVE
 * and is not us belongs to somebody else and is left alone, which is
 * the same rule the periodic sweep applies.
 */

import { execFile } from 'node:child_process';
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
  /**
   * How to read the process table.
   *
   * `null` means the table could not be read — distinct from `[]`, which
   * means it was read and holds no fork-workers. The two used to be one
   * value and therefore one set of metrics, so a janitor that had not
   * completed a sweep in hours reported clean ones.
   */
  readonly listProcesses?: () => readonly PsRow[] | null | Promise<readonly PsRow[] | null>;

  /**
   * How a process is signalled. Defaults to `process.kill`.
   *
   * Injectable because a janitor whose kill cannot be intercepted cannot be
   * tested without killing: a test naming a pid it believes is imaginary
   * sends a real signal to whatever holds that number on the machine
   * running the suite. That is not hypothetical — it happened while writing
   * the tests for this file, to a process holding a port on a live stand,
   * and this repository has a previous incident of the same shape where a
   * unit test reached `coldStartSweep` and killed six backends.
   *
   * A seam here makes the dangerous path unreachable from a test by
   * construction, rather than by every future test remembering.
   */
  readonly kill?: (pid: number, signal: NodeJS.Signals) => void;
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
  /**
   * False when `ps` could not be read at all.
   *
   * Without this a failed sweep reported `forkWorkersAlive: 0`, `orphansFound:
   * 0` — a measurement of nothing, indistinguishable from a machine with
   * nothing to reap. Measured on the development host: 990 sweeps skipped
   * and every one of them recorded as a clean one.
   */
  readonly swept: boolean;
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
  /** Sweeps that could not read the process table, in a row. */
  private consecutiveSkips = 0;
  private readonly logger: ILogger | undefined;
  private readonly onMetrics: ((m: JanitorSweepMetrics) => void) | undefined;
  private readonly getOwnedPids: () => ReadonlySet<number>;
  private readonly listProcesses: () => readonly PsRow[] | null | Promise<readonly PsRow[] | null>;
  private readonly kill: (pid: number, signal: NodeJS.Signals) => void;
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
    this.kill = options.kill ?? ((pid, signal) => process.kill(pid, signal));
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
    const listed = await this.listProcesses();
    if (listed === null) {
      this.logger?.error?.(
        'janitor: cold start could not read the process table — leftovers from a previous daemon are not being reaped',
      );
      return 0;
    }
    const all = listed;
    // A foreign parent is not evidence of a dead one.
    //
    // This read `row.ppid !== myPid` — reap anything not parented by ME —
    // on the assumption that only the daemon ever calls this, and only at
    // boot. Nothing enforces that assumption, and when it is wrong the cost
    // is every running app on the machine. Measured 2026-09-12: one unit
    // test constructing an `OrchestratorService` and calling `startApp`
    // reached `ensureBootReconciled` → `coldStartSweep`, where
    // `process.pid` was the vitest worker's, and killed all six backends of
    // the live dev stand. The daemon itself survived, so `omnitron ls`
    // reported `crashed` for apps nothing had crashed.
    //
    // `runSweep` below already had the right rule and this did not: "some
    // other parent — not ours, leave alone". The two halves of one janitor
    // disagreed about what an orphan is, and only the cheap half ran at the
    // moment nothing else was there to object.
    //
    // But `!isAlive(ppid)` cannot answer the question this sweep exists for.
    // When a parent dies its children are REPARENTED — to launchd on macOS,
    // to init or a subreaper on Linux — so an orphan's `ppid` becomes 1, and
    // pid 1 is alive on every running system. The test therefore returned
    // `false` for precisely the processes the docblock above promises to
    // kill, and the sweep could not reap a single one of them.
    //
    // Measured 2026-09-14, minutes after a daemon restart: seven
    // `fork-worker.js` processes with `ppid = 1`, the oldest four and a half
    // hours old, still holding their TCP ports. Their supervised replacements
    // could not bind, failed to start, burned their whole restart budget on
    // `EADDRINUSE` and gave up — so the console reported the APPLICATIONS as
    // crashed, and the cause was the supervisor's own leftovers. They also
    // ignored SIGTERM and needed SIGKILL, which is what `reap` already does.
    //
    // `ppid === REAPER_PID` is the orphan signature, and it is the one case
    // where "not my child" really is evidence of a dead parent.
    const stale = all.filter((row) => row.ppid !== myPid && this.hasDeadParent(row));

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
    const listed = await this.listProcesses();
    const myPid = process.pid;

    if (listed === null) {
      // A sweep that could not look is not a sweep that found nothing. Both
      // used to produce the same metrics and the same silence, so a janitor
      // disabled for hours was indistinguishable from a tidy machine.
      this.consecutiveSkips += 1;
      // The first skip is noise; a run of them is a janitor that has stopped
      // working, and the number is what makes that visible.
      const level = this.consecutiveSkips >= 5 ? 'error' : 'warn';
      this.logger?.[level]?.(
        { consecutiveSkips: this.consecutiveSkips, intervalMs: this.intervalMs },
        this.consecutiveSkips >= 5
          ? 'janitor: has not completed a sweep in several attempts — orphaned workers are not being reaped'
          : 'janitor: sweep skipped, could not read the process table',
      );
      const skipped: JanitorSweepMetrics = {
        scannedAt: new Date(),
        swept: false,
        forkWorkersAlive: 0,
        ownedPids: owned.size,
        orphansFound: 0,
        orphansKilled: 0,
        killErrors: 0,
      };
      this.onMetrics?.(skipped);
      return skipped;
    }

    this.consecutiveSkips = 0;
    const all = listed;

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
      // Process adopted by the reaper (parent is gone) → orphan from a
      // previous daemon that died. Reap it.
      //
      // This read `!this.isAlive(row.ppid)` and could therefore never fire.
      // The two halves of this janitor disagreed about what an orphan is:
      // `coldStartSweep` was corrected to test the reaper pid and this was
      // left behind, so the branch its own comment describes was unreachable
      // here for as long as the daemon ran. Measured 2026-09-14 minutes after
      // a restart: a `fork-worker.js` with `ppid = 1`, five minutes old,
      // surveyed by every sweep and reaped by none.
      if (this.hasDeadParent(row)) return true;
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
      swept: true,
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
   * Whether this row's parent is gone.
   *
   * One statement, used by both sweeps, because they have already disagreed
   * about it once: when a parent dies its children are REPARENTED — to
   * launchd on macOS, to init or a subreaper elsewhere — so an orphan's
   * `ppid` becomes 1, and pid 1 is alive on every running system. Asking
   * `isAlive(ppid)` therefore answers "the parent is fine" for precisely the
   * processes both sweeps exist to reap, and the liveness test is kept only
   * for the case where a ppid points at something that really has vanished
   * without reparenting.
   */
  private hasDeadParent(row: PsRow): boolean {
    return row.ppid === REAPER_PID || !this.isAlive(row.ppid);
  }

  /**
   * SIGTERM all pids → wait `gracefulMs` → SIGKILL any survivor.
   * Returns the number of pids successfully terminated (including
   * those killed forcefully).
   */
  /**
   * SIGTERM, a grace period, then SIGKILL for whatever is still there.
   *
   * Three things this used to get wrong, and all three were invisible:
   *
   *  - **A process was counted twice.** One that answered `ESRCH` to SIGTERM
   *    (already gone) scored a success, and then scored a second one in the
   *    SIGKILL pass for not being alive. `Math.min(success, pids.length)` at
   *    the end hid it — for the BATCH, not per process: one double-count plus
   *    one process that genuinely refused to die still clamped to "all
   *    reaped". A clamp is not a count.
   *  - **SIGKILL was assumed to have worked.** Success was recorded when the
   *    signal was SENT. A process that does not die is exactly the one worth
   *    knowing about, and it was the one that reported success.
   *  - **The escalation was silent.** Measured 2026-09-14: every orphan
   *    holding a port ignored SIGTERM and needed SIGKILL. "Died politely" and
   *    "had to be killed" produced identical logs, so the fact that these
   *    processes do not respond to TERM could not be learned from the record.
   */
  private async reap(pids: number[]): Promise<number> {
    const pending: number[] = [];

    for (const pid of pids) {
      try {
        this.kill(pid, 'SIGTERM');
        pending.push(pid);
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code !== 'ESRCH') {
          // Not "already gone" — a permission problem, most likely. It will
          // not die on SIGKILL either, so it is not pending.
          this.logger?.warn?.({ pid, err }, 'janitor: SIGTERM failed');
        }
      }
    }

    if (pending.length === 0) return pids.length;

    await wait(this.gracefulMs);

    const stubborn = pending.filter((pid) => this.isAlive(pid));
    if (stubborn.length > 0) {
      this.logger?.warn?.(
        { pids: stubborn.slice(0, 10), gracefulMs: this.gracefulMs },
        'janitor: processes ignored SIGTERM — escalating to SIGKILL',
      );
    }

    for (const pid of stubborn) {
      try {
        this.kill(pid, 'SIGKILL');
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code !== 'ESRCH') this.logger?.error?.({ pid, err }, 'janitor: SIGKILL failed');
      }
    }

    // Confirm. A signal sent is not a process gone.
    //
    // Polled rather than checked once. SIGKILL is delivered immediately but
    // the process is not reaped until the kernel can tear it down, and one in
    // uninterruptible sleep — blocked on disk, which is the state a machine
    // under load puts them in — takes longer than any single sample. The
    // first version waited 500 ms and then reported at ERROR level that the
    // process had "survived SIGKILL"; observed 2026-09-14 on a pid that was
    // gone moments later. An alarm that fires on a normal delay teaches its
    // reader to disregard the case it exists to report.
    const survivors = await this.awaitDeath(stubborn);
    if (survivors.length > 0) {
      this.logger?.error?.(
        { pids: survivors.slice(0, 10), waitedMs: KILL_CONFIRM_TIMEOUT_MS },
        'janitor: processes survived SIGKILL — still holding whatever they hold',
      );
    }
    return pids.length - survivors.length;
  }

  /**
   * Wait for killed pids to leave the process table, up to a deadline.
   * Returns whichever are still there when it expires.
   */
  private async awaitDeath(pids: number[]): Promise<number[]> {
    if (pids.length === 0) return [];
    const deadline = Date.now() + KILL_CONFIRM_TIMEOUT_MS;
    let remaining = pids;
    while (remaining.length > 0 && Date.now() < deadline) {
      await wait(KILL_CONFIRM_POLL_MS);
      remaining = remaining.filter((pid) => this.isAlive(pid));
    }
    return remaining;
  }
}

// ---------------------------------------------------------------------------
// Process-table helpers (production defaults)
// ---------------------------------------------------------------------------

/**
 * The pid a dead parent's children are handed to.
 *
 * 1 on every Unix this runs on — launchd on macOS, init or a subreaper
 * elsewhere. A `fork-worker.js` parented here was started by a daemon that no
 * longer exists.
 */
const REAPER_PID = 1;

/** How long the janitor waits for `ps` before giving up on a sweep. */
/**
 * How long `ps` may take.
 *
 * This was ten seconds, and `ps -eo pid,ppid,etime,args` over a thousand
 * processes takes 0.07. The deadline was not protecting against a slow `ps`;
 * it was firing because the DAEMON'S event loop was too busy to read the
 * result, and `execFile`'s timer — also on that loop — eventually killed a
 * process that had already finished.
 *
 * Measured on the development host: 990 sweeps killed their own `ps` and
 * skipped, while 36 fork-workers accumulated as children of a daemon that
 * claimed none of them. The janitor stops working exactly when the machine
 * is loaded, which is exactly when orphans appear.
 *
 * Sixty seconds is protection against a `ps` that genuinely hangs — an NFS
 * mount, a wedged process table — and not against a control plane doing
 * its job. It is a third of the sweep interval, so a slow sweep still
 * finishes before the next one starts.
 */
const PS_TIMEOUT_MS = 60_000;

/** How long a SIGKILLed process is given to actually leave the process table. */
const KILL_CONFIRM_TIMEOUT_MS = 5_000;
/** How often that is rechecked. */
const KILL_CONFIRM_POLL_MS = 100;

/**
 * `ps`, asynchronously and with a deadline.
 *
 * This was `execSync('ps -eo …')` with no timeout, called from a 30-second
 * `setInterval` on the daemon's own event loop. A synchronous spawn blocks
 * that loop completely: while it runs the daemon answers no RPC, writes no
 * log line, and services no socket. With no timeout, "while it runs" has no
 * upper bound.
 *
 * That is not hypothetical. Observed 2026-09-14 on the development daemon:
 * the main thread parked in `SyncProcessRunner::Spawn`, reached from
 * `Environment::RunTimers`, for eight minutes and counting — `omnitron ping`,
 * `omnitron ls` and every console request hung, the log stopped mid-second,
 * and the seventeen supervised app processes ran on with nothing watching
 * them. One `ps` that does not return takes the entire control plane with it.
 *
 * Asynchronous, so a slow `ps` costs a sweep rather than the daemon; and
 * timed out, so it costs a bounded one.
 */
function runPs(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'ps',
      ['-eo', 'pid,ppid,etime,args'],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: PS_TIMEOUT_MS, killSignal: 'SIGKILL' },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      },
    );
  });
}

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
async function listForkWorkersFromPs(logger?: ILogger): Promise<PsRow[] | null> {
  let raw: string;
  try {
    raw = await runPs();
  } catch (err) {
    // A `ps` that was KILLED for exceeding the deadline and one that failed
    // in a millisecond are the same empty result and, without this, the same
    // log line — so the condition that used to hang the daemon would leave
    // no trace that it had happened at all. `killed` is what `execFile` sets
    // when its own timeout fires.
    const e = err as NodeJS.ErrnoException & { killed?: boolean };
    if (e.killed) {
      logger?.error?.(
        { timeoutMs: PS_TIMEOUT_MS },
        'janitor: ps exceeded its deadline and was killed — sweep skipped',
      );
    } else {
      logger?.warn?.({ err: e.message }, 'janitor: ps failed');
    }
    // `null`, not `[]`. An empty list is an answer — "nothing is running" —
    // and returning it for a sweep that could not look reported 990 clean
    // sweeps on a host where 36 fork-workers were accumulating.
    return null;
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
