/**
 * `child.killed` means "a signal was SENT", and this file read it as "the
 * process is gone" in four places.
 *
 * Node's contract: `subprocess.killed` is set when `subprocess.kill()`
 * successfully delivers a signal to the OS. Whether the child installed a
 * handler, ignored it, and kept running is not part of the answer. Every titan
 * child installs a SIGTERM handler, so this is not an edge case — it is the
 * normal case.
 *
 * Two consequences, and together they are a defect observed on a live daemon:
 *
 *   - `WorkerHandle.isAlive()` returned `!child.killed && exitCode === null`,
 *     so a child that ignored SIGTERM reported DEAD while it ran. The
 *     orchestrator asks this; the app was listed `crashed` with no pid while
 *     that same child answered on its port.
 *   - The spawn-error cleanup fired SIGTERM and scheduled
 *     `if (!child.killed) kill('SIGKILL')` 3s later — a branch that can never
 *     be taken once a signal has been sent. The child survived the cleanup,
 *     the `finally` released the spawner's claim on it, and it belonged to
 *     nobody: it kept its listen port and every replacement failed with
 *     `EADDRINUSE`. The daemon's orphan sweep could not help either, because
 *     that looks for `ppid === REAPER_PID` and this child's parent — the
 *     daemon — was alive.
 *
 * The correct predicate was already in this package: `liveness.ts`, written
 * for the "ghost-online" bug, asks the OS with signal 0. `process-spawner.ts`
 * simply never called it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('./fixtures/ignores-sigterm.cjs', import.meta.url));

const spawned: ChildProcess[] = [];
afterEach(() => {
  for (const c of spawned.splice(0)) {
    try {
      if (c.pid) process.kill(c.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
});

async function startStubbornChild(): Promise<ChildProcess> {
  const child = fork(FIXTURE, [], { stdio: 'ignore' });
  spawned.push(child);
  await new Promise<void>((resolve) => child.once('message', () => resolve()));
  return child;
}

function osSaysAlive(pid: number | undefined): boolean {
  if (pid == null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

describe('what `killed` actually means', () => {
  it('is true the moment a signal is sent, while the process keeps running', async () => {
    const child = await startStubbornChild();
    expect(child.killed, 'nothing sent yet').toBe(false);
    expect(osSaysAlive(child.pid)).toBe(true);

    child.kill('SIGTERM');

    expect(child.killed, 'the signal was SENT').toBe(true);
    expect(osSaysAlive(child.pid), 'and the process is still there').toBe(true);
  });

  it('so an escalation guarded by `!child.killed` never runs', async () => {
    const child = await startStubbornChild();
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));

    // This is the branch the spawn-error cleanup used to schedule.
    const wouldEscalate = !child.killed;

    expect(wouldEscalate, 'the SIGKILL was unreachable code').toBe(false);
    expect(osSaysAlive(child.pid), 'which is why the child outlived its cleanup').toBe(true);
  });
});

describe('the liveness module answers correctly, and always did', () => {
  it('reports a SIGTERM-ignoring child as alive', async () => {
    const { isAlive } = await import('../src/liveness.js');
    const child = await startStubbornChild();
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));

    expect(isAlive(child.pid)).toBe(true);
  });

  it('and reports a genuinely dead one as dead', async () => {
    // Non-vacuity: a predicate that always says "alive" would pass the test
    // above while being useless.
    const { isAlive } = await import('../src/liveness.js');
    const child = await startStubbornChild();
    const pid = child.pid!;
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGKILL');
    await exited;

    expect(isAlive(pid)).toBe(false);
  });
});

describe('and the other arm of the old predicate was wrong too', () => {
  it('`exitCode === null` stays true for a child killed BY a signal', async () => {
    // The companion error, quieter than the first: Node fills `signalCode` and
    // leaves `exitCode` null when a signal ends the process. So
    // `!killed && exitCode === null` reported ALIVE for a child that had just
    // been SIGKILLed from outside — wrong in the opposite direction from the
    // case above, and in the direction that keeps a dead worker in the
    // registry. Both arms had to go.
    const child = await startStubbornChild();
    const pid = child.pid!;
    const exited = new Promise((r) => child.once('exit', r));
    process.kill(pid, 'SIGKILL'); // from outside: `child.killed` stays false
    await exited;

    expect(child.killed, 'we never called child.kill(), so this stayed false').toBe(false);
    expect(child.exitCode, 'a signal death leaves exitCode null').toBeNull();
    expect(child.signalCode).toBe('SIGKILL');

    const oldPredicateSaysAlive = !child.killed && child.exitCode === null;
    expect(oldPredicateSaysAlive, 'the old predicate called a dead child alive').toBe(true);

    const { isAlive } = await import('../src/liveness.js');
    expect(isAlive(pid), 'and the OS knows better').toBe(false);
  });
});

describe('the spawner no longer asks `killed` about liveness', () => {
  it('has no `child.killed` left in code, only in the notes explaining it', () => {
    const src = readFileSync(new URL('../src/process-spawner.ts', import.meta.url), 'utf8');
    const codeLines = src
      .split('\n')
      .filter((l) => l.includes('child.killed'))
      .filter((l) => !/^\s*(\*|\/\/)/.test(l.trim()) && !/^\s*\*/.test(l));

    expect(codeLines, `still read as liveness in: ${codeLines.join(' | ')}`).toEqual([]);
  });
});

/**
 * The helpers, exercised rather than named.
 *
 * An earlier version of this file asserted `expect(src).toMatch(/async function
 * killChildAndVerify/)` — which pins a NAME. A redaction, a guard or a kill
 * asserted by source text passes just as well when nothing calls it or when it
 * does the wrong thing under the right name, and that is the weakness this
 * repository keeps finding in its own checks. So: run them.
 */
describe('hasExited answers about the process, not about us', () => {
  it('false for a child that ignored our SIGTERM', async () => {
    const child = await startStubbornChild();
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));

    expect(hasExited(child)).toBe(false);
  });

  it('true once it is actually gone', async () => {
    const child = await startStubbornChild();
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGKILL');
    await exited;

    expect(hasExited(child)).toBe(true);
  });
});

describe('killChildAndVerify escalates, and says so honestly', () => {
  const quiet = () => {};
  const logger = { warn: quiet, error: quiet, info: quiet, debug: quiet, trace: quiet, fatal: quiet } as never;

  it('kills a child that ignores SIGTERM, and reports that it is gone', async () => {
    const child = await startStubbornChild();
    const pid = child.pid!;

    const gone = await killChildAndVerify(child, logger, { test: 'stubborn' });

    expect(gone, 'the escalation to SIGKILL has to actually happen').toBe(true);
    expect(osSaysAlive(pid), 'and the process is really gone').toBe(false);
  });

  it('does not spend the grace period on a child that leaves promptly', async () => {
    // The failure path is inside a spawn error, which a restart waits on. If
    // this always burned the full 3s grace, every failed spawn would take
    // three seconds longer to report — so the wait has to end on the exit
    // event, not on the timer.
    const child = await startStubbornChild();
    child.kill('SIGKILL'); // prompt exit, whatever the handler says
    await new Promise((r) => child.once('exit', r));

    const started = Date.now();
    const gone = await killChildAndVerify(child, logger, { test: 'prompt' });
    const elapsed = Date.now() - started;

    expect(gone).toBe(true);
    expect(elapsed, `waited ${elapsed}ms on an already-dead child`).toBeLessThan(500);
  });

  it('is a no-op on a child that already exited', async () => {
    const child = await startStubbornChild();
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGKILL');
    await exited;

    await expect(killChildAndVerify(child, logger, { test: 'already-dead' })).resolves.toBe(true);
  });
});

import { readFileSync } from 'node:fs';
import { hasExited, killChildAndVerify } from '../src/process-spawner.js';
