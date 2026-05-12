/**
 * State Store — Persist/recover process state across daemon restarts
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AppStatus } from '../config/types.js';

export interface PersistedAppState {
  name: string;
  pid: number | null;
  status: AppStatus;
  mode: 'classic' | 'bootstrap';
  startedAt: number;
  restarts: number;
  port: number | null;
}

export interface PersistedState {
  version: string;
  updatedAt: number;
  apps: PersistedAppState[];
}

export class StateStore {
  constructor(private readonly stateFile: string) {}

  save(state: PersistedState): void {
    const dir = path.dirname(this.stateFile);
    fs.mkdirSync(dir, { recursive: true });

    // T#55: write atomically — `writeFileSync(stateFile, ...)` was a
    // direct overwrite that left the file half-written if the
    // daemon was SIGKILL'd mid-flush. The next boot's `load()` then
    // saw truncated JSON, `JSON.parse` threw, and the daemon lost
    // the entire process registry (returned `null` and started from
    // scratch — every supervised app was treated as new).
    //
    // The standard POSIX recipe is:
    //   1. write payload to a SIBLING temp file in the same dir;
    //   2. fsync(tmp) so the bytes reach disk, not just page cache;
    //   3. rename(tmp, stateFile) — POSIX-atomic on one filesystem.
    //
    // Pick a unique temp suffix per call so concurrent calls (and
    // stale temp files from a crashed earlier write) don't collide.
    const payload = JSON.stringify(state, null, 2);
    const tmp = `${this.stateFile}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
    let fd: number | undefined;
    try {
      fd = fs.openSync(tmp, 'w');
      fs.writeFileSync(fd, payload, 'utf-8');
      // Force the data + metadata to disk before the rename so the
      // post-crash visible state is "either old contents or new
      // contents", never "renamed link to half-written bytes".
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(tmp, this.stateFile);
    } catch (err) {
      // Best-effort cleanup of the temp file if anything went wrong;
      // we already failed the save, no point hiding the failure.
      if (fd !== undefined) try { fs.closeSync(fd); } catch { /* */ }
      try { fs.unlinkSync(tmp); } catch { /* already gone */ }
      throw err;
    }
  }

  load(): PersistedState | null {
    try {
      const data = fs.readFileSync(this.stateFile, 'utf-8');
      return JSON.parse(data) as PersistedState;
    } catch {
      return null;
    }
  }

  clear(): void {
    try {
      fs.unlinkSync(this.stateFile);
    } catch {
      // File may not exist
    }
  }
}
