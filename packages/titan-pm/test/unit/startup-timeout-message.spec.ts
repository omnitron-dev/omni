/**
 * The timeout suffix must describe the timeout, not the last line of the
 * child's output.
 *
 * `Errors.timeout(operation, ms)` builds `${operation} timed out after ${ms}ms`
 * — the suffix goes at the END. The startup path passed a multi-line stderr
 * tail as part of `operation`, so the suffix landed after the last line the
 * child happened to print:
 *
 *     TitanError: Worker startup (pid: 18809)
 *     --- last child stderr ---
 *     [omnitron:boot] config:loading .../bootstrap.js timed out after 60000ms
 *
 * Which reads as a claim about `bootstrap.js` — that loading that file took
 * more than a minute. The truth is a different statement: the WORKER did not
 * finish starting within the timeout, and the last thing it managed to say was
 * that it was loading a config. The first sends a reader to investigate one
 * file; the second sends them to ask why the process never started.
 *
 * The tail itself is wanted — the comment above it says so, and single-line log
 * viewers do get a clue from it. What was wrong is the order: the sentence has
 * to be finished before anything is appended to it.
 *
 * Found by omni-d3 while investigating four apps in `errored` on the dev stand,
 * where the real cause was load average 139 against a 60-second startup budget.
 */

import 'reflect-metadata';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ProcessSpawner } from '../../src/process-spawner.js';

const silent = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child() {
    return this;
  },
};

const TMP = mkdtempSync(join(tmpdir(), 'startup-timeout-'));

/** A child that prints to stderr, never reports ready, and outlives the wait. */
function forkChattyChild(): ChildProcess {
  const file = join(TMP, `chatty-${Math.random().toString(36).slice(2)}.js`);
  writeFileSync(
    file,
    `process.stderr.write('[boot] config:loading /app/.omnitron-build/bootstrap.js\\n');
     process.stderr.write('[boot] module:imported\\n');
     setInterval(() => {}, 1000);`
  );
  return fork(file, [], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
}

const waitForReady = (child: ChildProcess, timeout: number): Promise<unknown> =>
  (
    new ProcessSpawner(silent as never) as unknown as {
      waitForReady: (w: ChildProcess, isThread: boolean, t: number) => Promise<unknown>;
    }
  ).waitForReady(child, false, timeout);

describe('the message a startup timeout produces', () => {
  let child: ChildProcess | undefined;

  afterEach(() => {
    if (child && !child.killed) child.kill('SIGKILL');
    child = undefined;
  });

  // afterAll, not afterEach: removing the directory between cases leaves the
  // later ones with nowhere to write their child.
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it('finishes its own sentence before quoting the child', async () => {
    child = forkChattyChild();

    const message = await waitForReady(child, 400).then(
      () => '',
      (e: Error) => e.message
    );

    const suffix = message.indexOf('timed out after');
    const quote = message.indexOf('--- last child stderr ---');

    expect(suffix, 'the timeout suffix is missing entirely').toBeGreaterThanOrEqual(0);
    expect(quote, 'the stderr tail is missing — it is wanted, just not first').toBeGreaterThanOrEqual(0);
    expect(
      suffix,
      'the timeout suffix landed after the quoted output, so it reads as a claim about the last line the child printed'
    ).toBeLessThan(quote);
  }, 30_000);

  it('does not attach the suffix to a line the child wrote', async () => {
    child = forkChattyChild();

    const message = await waitForReady(child, 400).then(
      () => '',
      (e: Error) => e.message
    );

    // The general property, not a literal. The first draft asserted
    // /bootstrap\.js timed out after/ and PASSED on the broken code, because
    // this fixture prints two stderr lines and the suffix glued itself to the
    // second one. A test pinned to whichever line happens to be last checks
    // the fixture, not the code.
    const suffixLine = message.split('\n').find((line) => line.includes('timed out after'));
    expect(suffixLine, 'no line carries the suffix').toBeDefined();
    expect(
      suffixLine,
      'the suffix shares a line with the child output, so it reads as a statement about that line'
    ).not.toMatch(/\[boot\]/);
  }, 30_000);

  it('still carries the tail and the full output in details', async () => {
    child = forkChattyChild();

    const err = (await waitForReady(child, 400).then(
      () => null,
      (e: unknown) => e as Error & { details?: { stderr?: string } }
    ))!;

    expect(err.message, 'the compact tail single-line viewers rely on is gone').toContain('config:loading');
    expect(err.details?.stderr, 'the full output no longer rides in details').toContain('module:imported');

    // And the structured field stays groupable. With the tail inside
    // `operation`, every timeout carried a different operation name — one per
    // distinct child output — so anything counting timeouts by operation saw
    // thousands of unique operations instead of one.
    const details = err.details as { operation?: string } | undefined;
    expect(details?.operation, 'the operation name absorbed the child output').not.toContain('config:loading');
    expect(details?.operation).toMatch(/^Worker startup/);
  }, 30_000);
});
