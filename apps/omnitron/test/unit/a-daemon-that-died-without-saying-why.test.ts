/**
 * Two implementations of "start the daemon", and neither kept a word of what
 * went wrong.
 *
 * `omnitron up` and `omnitron daemon start` each forked their own detached
 * child, and the copies had drifted — one waited 15 seconds, the other 30;
 * one passed `OMNITRON_NO_INFRA`, the other did not. Both used
 * `stdio: 'ignore'`, and neither set the child's working directory.
 *
 * That last one is what a remote install fails on. `--import tsx/esm` is
 * resolved by Node IN THE CHILD, from the child's cwd upward, because project
 * configs are TypeScript. The fork inherited whatever directory the CLI was
 * run from — over SSH, the login directory. Measured 2026-09-14 on a node
 * with omnitron under `/opt/omnitron`:
 *
 *     Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'tsx'
 *     imported from /root/
 *
 * Nobody saw it. `stdio: 'ignore'` discarded it, and the caller printed
 * "Daemon started — verifying connectivity timed out (may still be
 * initializing)" — a message about a slow start, concerning a process that
 * had already exited. Three separate causes were diagnosed that evening only
 * by running the daemon by hand in the foreground; every one of them would
 * have been a line in a file.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { spawnDaemon, describeStartupTimeout, DAEMON_EXEC_ARGV } from '../../src/daemon/spawn-daemon.js';

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A directory holding an entry script with the given body. */
function scratch(body: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-spawn-'));
  made.push(dir);
  const entry = path.join(dir, 'entry.js');
  fs.writeFileSync(entry, body);
  return { dir, entry, bootLog: path.join(dir, 'logs', 'daemon-boot.err.log') };
}

const settle = (ms = 800) => new Promise((r) => setTimeout(r, ms));

describe('a daemon that exits during startup', () => {
  it('leaves its reason in the boot log', async () => {
    const s = scratch('process.stderr.write("the reason it died\\n"); process.exit(3);');

    const spawned = spawnDaemon({
      entryPath: s.entry, packageRoot: s.dir, operatorCwd: s.dir, bootLogPath: s.bootLog, execArgv: [],
    });
    await settle();

    expect(fs.readFileSync(s.bootLog, 'utf8')).toContain('the reason it died');
    expect(spawned.isAlive()).toBe(false);
  });

  it('appends, so a crash loop keeps the first failure', async () => {
    // The first one is usually the informative one — later attempts fail for
    // consequences of it.
    const s = scratch('process.stderr.write(`attempt ${process.env.N}\\n`); process.exit(1);');

    for (const n of ['one', 'two']) {
      spawnDaemon({
        entryPath: s.entry, packageRoot: s.dir, operatorCwd: s.dir, bootLogPath: s.bootLog, execArgv: [],
        env: { N: n },
      });
      await settle(500);
    }

    const log = fs.readFileSync(s.bootLog, 'utf8');
    expect(log).toContain('attempt one');
    expect(log).toContain('attempt two');
  });

  it('creates the log directory rather than failing for want of it', async () => {
    const s = scratch('process.stderr.write("x\\n"); process.exit(1);');
    expect(fs.existsSync(path.dirname(s.bootLog))).toBe(false);

    spawnDaemon({ entryPath: s.entry, packageRoot: s.dir, operatorCwd: s.dir, bootLogPath: s.bootLog, execArgv: [] });
    await settle();

    expect(fs.existsSync(s.bootLog)).toBe(true);
  });

  it('starts at all — the stdio array must carry an IPC channel', async () => {
    // `fork` is `spawn` plus a message channel. An explicit stdio array
    // without `'ipc'` throws ERR_CHILD_PROCESS_IPC_REQUIRED in the PARENT,
    // before the child exists — so the boot log this array was added for
    // stays empty and the failure looks exactly like the daemon dying
    // instantly. The default `stdio: 'ignore'` supplied the channel
    // implicitly and hid the requirement.
    const s = scratch('process.send?.({ hello: true }); setTimeout(() => process.exit(0), 300);');

    const spawned = spawnDaemon({
      entryPath: s.entry, packageRoot: s.dir, operatorCwd: s.dir, bootLogPath: s.bootLog, execArgv: [],
    });

    expect(spawned.pid, 'the fork threw before producing a child').toBeGreaterThan(0);
    await settle(600);
    // Nothing on stderr: it ran, rather than failing to be forked.
    expect(fs.readFileSync(s.bootLog, 'utf8')).toBe('');
  });
});

describe('where the child looks for its loader', () => {
  it('runs from the package root, not the operator’s directory', async () => {
    // The whole remote-install failure in one assertion. `packageRoot` is
    // where `node_modules` is; `operatorCwd` is where the human was standing.
    const s = scratch('process.stderr.write(process.cwd() + "\\n"); process.exit(0);');
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-elsewhere-'));
    made.push(elsewhere);

    spawnDaemon({
      entryPath: s.entry, packageRoot: s.dir, operatorCwd: elsewhere, bootLogPath: s.bootLog, execArgv: [],
    });
    await settle();

    expect(fs.readFileSync(s.bootLog, 'utf8').trim()).toBe(fs.realpathSync(s.dir));
  });

  it('still tells the daemon where the operator was', async () => {
    // That directory decides which project the daemon picks up — a separate
    // question from where its own dependencies live, and the reason both are
    // passed.
    const s = scratch('process.stderr.write(process.env.OMNITRON_CWD + "\\n"); process.exit(0);');
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-elsewhere-'));
    made.push(elsewhere);

    spawnDaemon({
      entryPath: s.entry, packageRoot: s.dir, operatorCwd: elsewhere, bootLogPath: s.bootLog, execArgv: [],
    });
    await settle();

    expect(fs.readFileSync(s.bootLog, 'utf8').trim()).toBe(elsewhere);
  });
});

describe('what the operator is told when it does not answer in time', () => {
  it('tells a slow boot from a dead one', () => {
    const alive = describeStartupTimeout({ pid: 1, bootLogPath: '/l', isAlive: () => true }, 30_000);
    const dead = describeStartupTimeout({ pid: 1, bootLogPath: '/l', isAlive: () => false }, 30_000);

    expect(alive.ok).toBe(true);
    expect(alive.message).toMatch(/still starting/);
    expect(dead.ok).toBe(false);
    expect(dead.message).toMatch(/exited during startup/);
  });

  it('names the boot log when it died, because that is where the answer is', () => {
    const dead = describeStartupTimeout(
      { pid: 1, bootLogPath: '/root/.omnitron/logs/daemon-boot.err.log', isAlive: () => false },
      30_000,
    );

    expect(dead.detail).toContain('/root/.omnitron/logs/daemon-boot.err.log');
  });
});

describe('the loader the daemon is started with', () => {
  it('is the TypeScript one, by default', () => {
    // Project configs are TypeScript, and this is why `packageRoot` matters
    // at all: Node resolves `tsx/esm` from the child's cwd upward. A test
    // that overrides this is testing something else.
    expect([...DAEMON_EXEC_ARGV]).toEqual(['--import', 'tsx/esm']);
  });

  it('looks for it where the package is', async () => {
    // The failure that started all of this, reproduced: default execArgv, a
    // packageRoot with no `node_modules`.
    const s = scratch('process.exit(0);');

    spawnDaemon({ entryPath: s.entry, packageRoot: s.dir, operatorCwd: s.dir, bootLogPath: s.bootLog });
    await settle();

    expect(fs.readFileSync(s.bootLog, 'utf8')).toContain("Cannot find package 'tsx'");
  });
});
