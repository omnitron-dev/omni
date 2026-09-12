/**
 * A pid in a file is a claim about the past.
 *
 * The daemon dies, the OS hands its number to whatever starts next, and a
 * SIGKILL aimed at "the daemon" lands on a stranger. `PidManager` has known
 * this since T#56 — `isRunning()` checks liveness AND the recorded argv
 * signature, and `cleanupStale()` treats "different process alive at this
 * pid" as stale.
 *
 * `daemonKill` reached past all of it: `readPid()` plus "is something alive
 * there". The recovery for the recycled case was written and never reached
 * from that path. `daemonStop` validated once and then waited twenty seconds
 * before escalating to SIGKILL on the number it had captured — and that
 * branch runs only when the daemon has NOT exited on its own, which is when
 * the file is most likely to be out of date.
 *
 * These tests are about `PidManager`, which is where the rule lives. The two
 * callers now both ask it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PidManager } from '../../src/daemon/pid-manager.js';

const made: string[] = [];
function pidFileWith(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-pid-'));
  made.push(dir);
  const f = path.join(dir, 'daemon.pid');
  fs.writeFileSync(f, content);
  return f;
}

afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('PidManager tells "alive" from "ours"', () => {
  it('claims the pid when the signature matches this very process', () => {
    // `process.execPath` is in our own argv, so the signature matches.
    const f = pidFileWith(`${process.pid}\n${process.execPath}`);

    expect(new PidManager(f).isRunning()).toBe(true);
    expect(new PidManager(f).getPid()).toBe(process.pid);
  });

  it('refuses a live pid whose argv is somebody else', () => {
    // The recycled case: alive, but not the daemon.
    const f = pidFileWith(`${process.pid}\n/opt/not-the-daemon/bin/something-else`);

    expect(new PidManager(f).isRunning()).toBe(false);
    expect(new PidManager(f).getPid(), 'getPid must not hand back a stranger').toBeNull();
  });

  it('still reads the raw number, which is what diagnostics want', () => {
    const f = pidFileWith(`${process.pid}\n/opt/not-the-daemon/bin/something-else`);

    // `readPid` deliberately answers for a dead or recycled pid — the
    // difference between it and `getPid` is the whole point.
    expect(new PidManager(f).readPid()).toBe(process.pid);
  });

  it('treats a recycled pid as stale and cleans up', () => {
    const f = pidFileWith(`${process.pid}\n/opt/not-the-daemon/bin/something-else`);

    expect(new PidManager(f).cleanupStale()).toBe(true);
    expect(fs.existsSync(f), 'the file named a process that is not ours').toBe(false);
  });

  it('does not clean up a pidfile that is still right', () => {
    const f = pidFileWith(`${process.pid}\n${process.execPath}`);

    expect(new PidManager(f).cleanupStale()).toBe(false);
    expect(fs.existsSync(f)).toBe(true);
  });

  it('falls back to liveness alone for a legacy pid-only file', () => {
    // Backward compatibility, and the limit of the protection: without a
    // recorded signature there is nothing to compare against.
    const f = pidFileWith(`${process.pid}`);

    expect(new PidManager(f).isRunning()).toBe(true);
  });

  it('answers null for a pid that is simply gone', () => {
    // 2^22 + 1 — above every default pid_max, so it cannot be live.
    const f = pidFileWith(`4194305\n${process.execPath}`);

    expect(new PidManager(f).getPid()).toBeNull();
  });
});

describe('the kill paths ask PidManager rather than the number', () => {
  it('daemonKill validates identity before SIGKILL', () => {
    const src = fs.readFileSync(
      new URL('../../src/commands/daemon-cmd.ts', import.meta.url),
      'utf8',
    );
    const fn = src.slice(src.indexOf('export async function daemonKill'));
    const body = fn.slice(0, fn.indexOf('\nexport '));

    // The guard before the kill must be the identity one, not liveness.
    const killAt = body.indexOf("process.kill(rawPid, 'SIGKILL')");
    expect(killAt).toBeGreaterThan(0);
    expect(body.slice(0, killAt)).toContain('pidManager.getPid()');
  });

  it('daemonStop re-validates before escalating to SIGKILL', () => {
    const src = fs.readFileSync(
      new URL('../../src/commands/daemon-cmd.ts', import.meta.url),
      'utf8',
    );
    const fn = src.slice(src.indexOf('export async function daemonStop'));
    const body = fn.slice(0, fn.indexOf('\nexport '));

    const killAt = body.lastIndexOf("process.kill(pid, 'SIGKILL')");
    expect(killAt).toBeGreaterThan(0);
    // The check immediately above it compares against the CURRENT answer.
    expect(body.slice(Math.max(0, killAt - 200), killAt)).toContain('pidManager.getPid() === pid');
  });
});
