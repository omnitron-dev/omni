/**
 * Running one pipeline step.
 *
 * The step runner used `execFile` with a 10 MB `maxBuffer`, which fails the
 * whole call when a command that exited 0 simply printed more than that:
 * "stdout maxBuffer length exceeded", reported to the operator as a failed
 * build. Verified before the change — a command doing `exit 0` after 200 KB
 * of output, against a 100 KB buffer, produced an error.
 *
 * A verbose build is not a broken build, and a pipeline that says otherwise
 * sends someone looking for a fault that is not there.
 */

import { describe, it, expect } from 'vitest';

import { PipelineService, __test__ } from '../../src/services/pipeline.service.js';

/** The runner touches neither the database nor the logger. */
const service = new PipelineService(
  {} as never,
  { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never
);

const run = (command: string, timeout = 10_000, signal?: AbortSignal) =>
  __test__.runShellCommand(service, command, undefined, timeout, signal ?? new AbortController().signal);

describe('runShellCommand', () => {
  it('returns what the command printed', async () => {
    expect(await run('printf hello')).toContain('hello');
  });

  it('succeeds when a command prints far more than the old buffer allowed', async () => {
    // The defect. 2 MB against the old 10 MB limit would have passed; the
    // point is that output volume no longer decides success at all, so this
    // asserts the exit code won rather than the byte count.
    const output = await run('yes 0123456789abcdef | head -c 2000000; exit 0');

    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain('0123456789abcdef');
  });

  it('says so when output was cut short, rather than silently shortening it', async () => {
    // Retention is capped at 1 MB. A truncated log that does not admit it is
    // a log an operator will read to the end and believe.
    const output = await run('yes 0123456789abcdef | head -c 4000000; exit 0');

    expect(output).toContain('output truncated');
  });

  it('fails when the command fails, and carries its stderr', async () => {
    await expect(run('echo "npm ERR! missing script: build" >&2; exit 1')).rejects.toThrow(
      /exited with code 1.*missing script/s
    );
  });

  it('keeps stderr from a step that succeeded', async () => {
    // Warnings a build printed used to be discarded on success — only the
    // failure path had them, and only inside a truncated Error message.
    const output = await run('echo out; echo "warning: deprecated API" >&2; exit 0');

    expect(output).toContain('out');
    expect(output).toContain('deprecated API');
  });

  it('reports a timeout as a timeout', async () => {
    await expect(run('sleep 5', 300)).rejects.toThrow(/timed out after 300ms/);
  });

  it('stops on abort rather than running to completion', async () => {
    const controller = new AbortController();
    const promise = run('sleep 5', 10_000, controller.signal);
    setTimeout(() => controller.abort(), 100);

    await expect(promise).rejects.toThrow(/aborted/);
  });

  it('reports a command that does not exist as a failure, not as empty output', async () => {
    await expect(run('definitely-not-a-command')).rejects.toThrow(/exited with code/);
  });
});
