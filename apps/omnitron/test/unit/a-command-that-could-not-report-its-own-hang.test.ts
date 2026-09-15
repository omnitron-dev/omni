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
const clientSrc = fs.readFileSync(path.join(root, 'src/daemon/daemon-client.ts'), 'utf8');
const cliSrc = fs.readFileSync(path.join(root, 'src/cli/omnitron.ts'), 'utf8');

describe('every wait the CLI makes on the daemon is bounded', () => {
  it('bounds the connect itself', () => {
    // Asserted on the source because reaching it needs a socket that accepts
    // and then answers nothing — which is a starved daemon, not something a
    // unit test can conjure. What is checkable is that the connect is not
    // awaited bare.
    const connect = clientSrc.slice(
      clientSrc.indexOf('private async ensureConnected'),
      clientSrc.indexOf('private async ensureConnected') + 1200,
    );

    expect(connect, 'ensureConnected awaits netron.connect with no deadline').toContain('withDeadline');
    expect(connect).toContain('CONNECT_TIMEOUT');
  });

  it('bounds the teardown', () => {
    const disconnect = clientSrc.slice(
      clientSrc.indexOf('  async disconnect()'),
      clientSrc.indexOf('  async disconnect()') + 2600,
    );

    expect(disconnect, 'netron.stop() is awaited with no deadline').toMatch(/withDeadline\(\s*\n?\s*this\.netron\.stop\(\)/);
  });

  it('gives the connect more room than the probe', () => {
    // They answer different questions. The probe asks "is anything there",
    // and five seconds is generous for a unix socket. The connect is real
    // work, and a loaded host can take seconds just to schedule the accept —
    // so a connect bounded by the probe's budget would fail on a machine that
    // is merely busy.
    const connectMs = Number(/const CONNECT_TIMEOUT = ([\d_]+);/.exec(clientSrc)?.[1]?.replace(/_/g, ''));
    const probeMs = Number(/const REACHABILITY_TIMEOUT = ([\d_]+);/.exec(clientSrc)?.[1]?.replace(/_/g, ''));

    expect(connectMs).toBeGreaterThan(probeMs);
  });

  it('does not keep the process alive with its own timers', () => {
    // A deadline that holds the event loop open would replace one hang with
    // another, quieter one.
    const deadline = clientSrc.slice(clientSrc.indexOf('function withDeadline'), clientSrc.indexOf('function withDeadline') + 600);

    expect(deadline).toContain('timer.unref');
    // And it must clear the timer on both outcomes, or a fast success still
    // waits for the deadline before the process can leave.
    expect((deadline.match(/clearTimeout/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('the CLI leaves when its work is done', () => {
  it('exits rather than waiting for handles it cannot close', () => {
    // Closing a socket gracefully needs the other end, which is exactly what
    // is missing when the daemon is wedged. The process is leaving; the OS
    // closes what it held.
    expect(cliSrc).toContain('parseAsync');
    expect(cliSrc).toMatch(/process\.exit\(process\.exitCode \?\? 0\)/);
  });

  it('keeps the exit code the commands set', () => {
    // This changes WHEN the process leaves, not what it says. A command that
    // reported a failure must still exit non-zero.
    expect(cliSrc).toMatch(/process\.exit\(process\.exitCode \?\? 1\)/);
  });

  it('still prints an error that reached the top', () => {
    // Commander prints its own and sets a code; anything else arriving here
    // is a bug in a command, and exiting quietly would hide it.
    const tail = cliSrc.slice(cliSrc.indexOf('program.parseAsync'));

    expect(tail).toContain('console.error');
  });
});
