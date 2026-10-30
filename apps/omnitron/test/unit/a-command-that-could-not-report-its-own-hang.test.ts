/**
 * `omnitron ping` produced no output and never returned.
 *
 * Measured 2026-09-15 against the development daemon, starved by unrelated
 * load at a load average of 107:
 *
 *     $ time omnitron ping
 *     (nothing at all)
 *     0.97s user  0.65s system  1% cpu  2:00.10 total
 *
 * Two minutes, at one percent CPU — waiting, not working — and killed by the
 * shell rather than reporting anything. Three unbounded waits, each of which
 * had to be closed before the next became visible.
 *
 * 1. `netron.connect` had no deadline. A unix socket whose listener exists
 *    but whose event loop is starved ACCEPTS the connection and never
 *    finishes the handshake, so the connect does not fail — it waits.
 *    `isReachable` looked like the bound and was not: it races five seconds
 *    against `ping()`, which bounds how long IT waits, while `daemonPing`
 *    awaits `client.ping()` directly.
 *
 * 2. With that closed, the diagnosis printed and the process still did not
 *    exit: `netron.stop()` in `disconnect()` was also unbounded, and closing
 *    a socket gracefully needs the other end.
 *
 * 3. With that closed too, three `PipeWrap` handles survived the teardown and
 *    held the event loop. A CLI that has said everything it has to say and
 *    cannot return is worse for a script than either the hang or the error
 *    alone: the output arrives and the exit never does.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cliSrc = fs.readFileSync(path.join(root, 'src/cli/omnitron.ts'), 'utf8');

// Connection, probe and teardown deadlines are exercised with a silent
// transport in daemon-client-connect.test.ts, rather than inferred from source.

describe('the CLI leaves when its work is done', () => {
  it('exits rather than waiting for handles it cannot close', () => {
    // Closing a socket gracefully needs the other end, which is exactly what
    // is missing when the daemon is wedged. The process is leaving; the OS
    // closes what it held.
    expect(cliSrc).toContain('parseAsync');
    // The drain helper's real-process test also checks complete piped output.
    expect(cliSrc).toMatch(/exitAfterOutput\(process\.exitCode \?\? 0\)/);
  });

  it('keeps the exit code the commands set', () => {
    // This changes WHEN the process leaves, not what it says. A command that
    // reported a failure must still exit non-zero.
    expect(cliSrc).toMatch(/exitAfterOutput\(process\.exitCode \?\? 1\)/);
  });

  it('still prints an error that reached the top', () => {
    // Commander prints its own and sets a code; anything else arriving here
    // is a bug in a command, and exiting quietly would hide it.
    const tail = cliSrc.slice(cliSrc.indexOf('program.parseAsync'));

    expect(tail).toContain('console.error');
  });
});
