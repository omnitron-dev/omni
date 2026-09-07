/**
 * The refusal to overwrite a PID file keeps what the filesystem said.
 *
 * `write()` turns `EEXIST` into a sentence an operator can act on — another
 * daemon is starting, or one crashed without cleanup. That sentence is the
 * right thing to show. Throwing it WITHOUT `cause` is what costs: the original
 * carries `errno`, `syscall` and the resolved `path`, and those are the fields
 * that tell a permissions problem from a race, or say which path was actually
 * attempted when the configured one and the resolved one differ.
 *
 * Found by `preserve-caught-error`, a rule written for this repository that
 * had never run — ESLint has been unable to load since the TypeScript 7
 * upgrade, and started working again today. It named three sites; this is the
 * one with a seam clean enough to pin from the outside.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PidManager } from '../../src/daemon/pid-manager.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pid-cause-'));
});

afterEach(() => {
  // Remove the directory, not the fixture root — an `afterEach` that deletes
  // a shared path makes every later test fail for a reason that is not its own.
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('PidManager.write — refusing an existing file', () => {
  it('attaches the filesystem error as `cause`', () => {
    const pidFile = path.join(dir, 'daemon.pid');
    fs.writeFileSync(pidFile, 'someone else\n');

    let thrown: unknown;
    try {
      new PidManager(pidFile).write();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    // The operator-facing sentence stays — it is the useful half.
    expect((thrown as Error).message).toMatch(/already exists/);
    // And the machine-facing half is no longer discarded.
    const cause = (thrown as Error).cause as NodeJS.ErrnoException | undefined;
    expect(cause, 'the EEXIST error must survive as `cause`').toBeDefined();
    expect(cause!.code).toBe('EEXIST');
    expect(cause!.path).toBe(pidFile);
  });

  it('still writes when the file is absent, and when overwrite is asked for', () => {
    // The other half has to survive: this guard exists to stop a second daemon,
    // not to stop the first one.
    const pidFile = path.join(dir, 'fresh.pid');
    expect(() => new PidManager(pidFile).write()).not.toThrow();
    expect(fs.readFileSync(pidFile, 'utf-8')).toContain(String(process.pid));

    expect(() => new PidManager(pidFile).write({ overwrite: true })).not.toThrow();
  });
});
