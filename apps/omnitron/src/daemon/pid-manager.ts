/**
 * PID File Management
 *
 * Prevents duplicate daemons and enables daemon discovery.
 * Also handles stale PID/socket cleanup for robust restart.
 */

import fs from 'node:fs';
import path from 'node:path';

export class PidManager {
  constructor(private readonly pidFile: string) {}

  /**
   * Check if another daemon is already running.
   * Uses process.kill(pid, 0) to verify liveness.
   */
  isRunning(): boolean {
    const pid = this.readPid();
    if (pid === null) return false;
    return PidManager.isProcessAlive(pid);
  }

  /**
   * Get the PID of the running daemon (only if alive).
   */
  getPid(): number | null {
    const pid = this.readPid();
    if (pid === null) return null;
    return PidManager.isProcessAlive(pid) ? pid : null;
  }

  /**
   * Get the raw PID from file (even if process is dead).
   * Useful for stale cleanup diagnostics.
   */
  readPid(): number | null {
    try {
      const pidStr = fs.readFileSync(this.pidFile, 'utf-8').trim();
      const pid = parseInt(pidStr, 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  /**
   * Write current process PID
   */
  write(): void {
    const dir = path.dirname(this.pidFile);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.pidFile, String(process.pid), 'utf-8');
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
   * Called when PID file exists but process is dead.
   * Returns true if stale state was found and cleaned.
   */
  cleanupStale(socketPath?: string): boolean {
    const rawPid = this.readPid();
    if (rawPid === null) return false;

    // If process is still alive, not stale
    if (PidManager.isProcessAlive(rawPid)) return false;

    // Process is dead — clean up stale files
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
   * Check if a process with given PID is alive.
   */
  static isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
