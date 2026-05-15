/**
 * PID File Management
 *
 * Prevents duplicate daemons and enables daemon discovery.
 * Also handles stale PID/socket cleanup for robust restart.
 *
 * T#56 hardening — PID reuse detection
 * ------------------------------------
 * `process.kill(pid, 0)` only answers "is SOMETHING alive at this
 * pid", not "is OUR daemon alive at this pid". After a daemon crash
 * the kernel will eventually recycle the pid for an unrelated
 * process (a Chrome tab, a Node REPL, whatever). The old pid file
 * still pointed at it, so `omnitron daemon start` falsely reported
 * "daemon already running" and refused to come up.
 *
 * Fix: write a signature alongside the pid (the daemon's argv[1] —
 * the entry-point script path). On read, after pid-alive, verify
 * the process at that pid actually has a matching argv. We read
 * argv via `/proc/<pid>/cmdline` on Linux and `ps -p <pid> -o args=`
 * on macOS / BSD; both are read-only and fast. If we can't tell
 * either way (privilege issue, exotic platform), fall back to the
 * pid-only check — strictly an improvement over the historical
 * behaviour.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isProcessAlive } from '@omnitron-dev/titan/utils';

export class PidManager {
  constructor(private readonly pidFile: string) {}

  /**
   * Check if another daemon is already running.
   * Uses process.kill(pid, 0) to verify liveness AND argv signature
   * to verify the live process is actually the same daemon.
   */
  isRunning(): boolean {
    const pid = this.readPid();
    if (pid === null) return false;
    if (!PidManager.isProcessAlive(pid)) return false;
    // T#56: pid is alive — but is it actually OUR daemon? If we
    // recorded a signature and it doesn't match, treat as stale.
    const recordedSignature = this.readSignature();
    if (recordedSignature && !PidManager.processArgvMatches(pid, recordedSignature)) {
      return false;
    }
    return true;
  }

  /**
   * Get the PID of the running daemon (only if alive).
   */
  getPid(): number | null {
    const pid = this.readPid();
    if (pid === null) return null;
    return this.isRunning() ? pid : null;
  }

  /**
   * Get the raw PID from file (even if process is dead).
   * Useful for stale cleanup diagnostics.
   */
  readPid(): number | null {
    try {
      const raw = fs.readFileSync(this.pidFile, 'utf-8').trim();
      // Backward-compat: legacy pidfiles contain only the pid; the
      // T#56 format is `<pid>\n<signature>`. Either way `parseInt`
      // on the first non-empty line returns the right thing.
      const firstLine = raw.split('\n')[0]?.trim() ?? '';
      const pid = parseInt(firstLine, 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  /**
   * Read the signature line from the pidfile, if present.
   * Returns null for legacy (pid-only) files.
   */
  private readSignature(): string | null {
    try {
      const raw = fs.readFileSync(this.pidFile, 'utf-8');
      const second = raw.split('\n')[1]?.trim();
      return second && second.length > 0 ? second : null;
    } catch {
      return null;
    }
  }

  /**
   * Write current process PID + signature.
   */
  write(): void {
    const dir = path.dirname(this.pidFile);
    fs.mkdirSync(dir, { recursive: true });
    const signature = PidManager.currentSignature();
    fs.writeFileSync(this.pidFile, `${process.pid}\n${signature}\n`, 'utf-8');
  }

  /**
   * Remove PID file
   */
  remove(): void {
    try {
      fs.unlinkSync(this.pidFile);
    } catch {
      // File may not exist
    }
  }

  /**
   * Clean up stale PID file and optionally a socket file.
   * Called when PID file exists but process is dead OR the live
   * process is a pid-reused stranger.
   * Returns true if stale state was found and cleaned.
   */
  cleanupStale(socketPath?: string): boolean {
    const rawPid = this.readPid();
    if (rawPid === null) return false;

    // T#56: treat both "no process alive" and "different process is
    // alive at this pid" as stale. The old logic only handled the
    // dead-process case, so a recycled pid sat in the file forever.
    if (this.isRunning()) return false;

    // Stale — clean up.
    this.remove();

    if (socketPath) {
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // Socket may not exist
      }
    }

    return true;
  }

  /**
   * Check if a process with given PID is alive. Thin delegate to
   * the shared helper in `@omnitron-dev/titan/utils` — kept on
   * `PidManager` as a static so existing call sites continue to
   * work, but the actual semantic (EPERM-as-alive,
   * invalid-pid-as-dead) lives in one place. Pre-fix this
   * version caught ALL errors as dead and so mis-classified
   * processes owned by another uid (EPERM) as crashed —
   * potentially triggering false-positive restarts in
   * multi-tenant supervisors.
   */
  static isProcessAlive(pid: number): boolean {
    return isProcessAlive(pid);
  }

  /**
   * The signature this daemon will record in its pidfile. Currently
   * the absolute entry-point script path (argv[1]). Two daemon
   * processes with the same script path are treated as the same
   * service for pid-reuse purposes, which is the right granularity
   * for omnitron.
   */
  static currentSignature(): string {
    return process.argv[1] ?? '';
  }

  /**
   * Best-effort argv check against the recorded signature.
   *
   * Returns true if we positively verified a match, false if we
   * positively verified a mismatch (pid was reused), and — to err
   * on the safe side — true if we couldn't read argv at all. The
   * "unknown → assume same" fallback preserves the legacy behaviour
   * for platforms where we can't introspect the live process.
   */
  static processArgvMatches(pid: number, expectedSignature: string): boolean {
    if (!expectedSignature) return true;

    // Linux: /proc/<pid>/cmdline is null-separated argv.
    if (process.platform === 'linux') {
      try {
        const buf = fs.readFileSync(`/proc/${pid}/cmdline`);
        const argv = buf.toString('utf-8').split('\0').filter(Boolean);
        return argv.includes(expectedSignature);
      } catch {
        return true; // unknown — assume the same daemon
      }
    }

    // macOS / BSD: shell out to `ps`. -o args= prints the command
    // line; bounded output, ms-scale, safe to call in this rare path.
    if (process.platform === 'darwin' || process.platform.includes('bsd')) {
      try {
        const res = spawnSync('ps', ['-p', String(pid), '-o', 'args='], {
          encoding: 'utf-8',
          timeout: 2_000,
        });
        if (res.status === 0 && typeof res.stdout === 'string') {
          return res.stdout.includes(expectedSignature);
        }
      } catch {
        /* fall through */
      }
      return true;
    }

    // Windows / other — no portable cheap check; preserve legacy
    // pid-only semantics.
    return true;
  }
}
