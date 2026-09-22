/**
 * A deadline that reached only the first process in the tree.
 *
 * The artifact build ran `promisify(execFile)(pnpm, ['build'], { timeout:
 * 300_000 })`. On `daos-test`, 2026-09-22, the build of `main` ran 21 minutes
 * and nothing reported that the limit had passed. The two ways a
 * direct-child-only deadline fails are driven below against a REAL process
 * tree — a shell that starts a grandchild — because a one-level fake is the
 * one case where the old code also worked.
 */

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { execInGroup } from '../../src/project/exec-in-group.js';

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The grandchild's pid is the first line the shell prints. */
const grandchildOf = (stdout: string) => Number.parseInt(stdout.trim().split('\n')[0] ?? '', 10);

const EXITS_ON_TERM = 'sleep 8 & echo $!; wait';
const WAITS_ON_ITS_CHILDREN = 'trap "" TERM; sleep 8 & echo $!; wait';

describe('the old deadline, measured', () => {
  // Not a test of the new code: the record of what it replaced. Each asserts
  // the defect, so if a Node upgrade ever makes execFile kill the group,
  // these go red and say the helper may no longer be needed.
  const oldExec = promisify(execFile);

  it('left the real work running when the first process obeyed', async () => {
    const err: any = await oldExec('sh', ['-c', EXITS_ON_TERM], { timeout: 300 }).catch((e) => e);
    const g = grandchildOf(err.stdout ?? '');
    expect(alive(g)).toBe(true);
    process.kill(g, 'SIGKILL');
  });

  it('bounded nothing when the first process waited', async () => {
    const t0 = Date.now();
    await oldExec('sh', ['-c', WAITS_ON_ITS_CHILDREN], { timeout: 300 }).catch(() => undefined);
    // It settled when the grandchild finished on its own, not at 300 ms.
    expect(Date.now() - t0).toBeGreaterThan(7_000);
  }, 20_000);
});

describe('a deadline that reaches the whole tree', () => {
  it('stops a grandchild when the first process obeys', async () => {
    const t0 = Date.now();
    const err: any = await execInGroup('sh', ['-c', EXITS_ON_TERM], { timeout: 300, killGraceMs: 500 }).catch(
      (e) => e,
    );
    expect(err.timedOut).toBe(true);
    expect(Date.now() - t0).toBeLessThan(3_000);
    await new Promise((r) => setTimeout(r, 100));
    expect(alive(grandchildOf(err.stdout))).toBe(false);
  });

  it('stops a grandchild when the first process ignores the signal', async () => {
    const t0 = Date.now();
    const err: any = await execInGroup('sh', ['-c', WAITS_ON_ITS_CHILDREN], {
      timeout: 300,
      killGraceMs: 500,
    }).catch((e) => e);
    expect(err.timedOut).toBe(true);
    // Deadline plus grace, not the grandchild's own eight seconds.
    expect(Date.now() - t0).toBeLessThan(3_000);
    await new Promise((r) => setTimeout(r, 100));
    expect(alive(grandchildOf(err.stdout))).toBe(false);
  });

  it('names the deadline, and carries what the build said', async () => {
    const err: any = await execInGroup('sh', ['-c', 'echo compiling; sleep 5'], {
      timeout: 300,
      killGraceMs: 200,
    }).catch((e) => e);
    expect(err.message).toMatch(/exceeded 300 ms and was stopped with everything it started/);
    expect(err.stdout).toContain('compiling');
  });

  it('returns output and does not time out when the command finishes in time', async () => {
    // The control: a helper that always "timed out" would pass the tests above.
    const out = await execInGroup('sh', ['-c', 'echo done'], { timeout: 5_000 });
    expect(out.stdout.trim()).toBe('done');
  });

  it('reports a failure as a failure, with the exit code the caller reads', async () => {
    const err: any = await execInGroup('sh', ['-c', 'echo "TS2307: cannot find" >&2; exit 2'], {
      timeout: 5_000,
    }).catch((e) => e);
    expect(err.timedOut).toBe(false);
    expect(err.code).toBe(2);
    expect(err.stderr).toContain('TS2307');
  });
});

describe('the artifact build uses it', () => {
  // Structural, and knowingly so: the helper's behaviour is pinned above
  // against a real process tree; what is left to hold is that the build goes
  // THROUGH it. A revert to `exec(…)` would keep every test above green and
  // bring back a 30-minute limit that stops nothing.
  it('runs `pnpm build` through the whole-tree deadline', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../src/project/artifact-builder.ts', import.meta.url), 'utf8');
    const { stripComments } = await import('../../../../scripts/lib/strip-comments.mjs');
    const code = stripComments(src);
    expect(code).toMatch(/execInGroup\(resolvePnpm\(\), \['build'\]/);
    expect(code).not.toMatch(/[^A-Za-z]exec\(resolvePnpm\(\), \['build'\]/);
  });
});
