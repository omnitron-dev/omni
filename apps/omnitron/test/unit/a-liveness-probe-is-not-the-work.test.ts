/**
 * "Is the daemon alive" and "do the work" take different amounts of time.
 *
 * Every command that touches an application asks `isReachable()` first, to
 * decide whether to auto-start the daemon or fall back to signalling its pid.
 * That probe used to run on the command's REQUEST timeout — so widening the
 * timeout for commands that legitimately wait minutes (starting a Titan
 * application connecting to a database, Redis and its siblings) would have
 * widened the probe with it, and `omnitron stop` against a wedged daemon
 * would sit for ten minutes before reaching the fallback written for exactly
 * that case.
 *
 * The failure this guards against was measured, not imagined: on 2026-09-14
 * the daemon accepted connections on its socket and answered nothing for
 * thirteen minutes. A probe that waits for an answer from a process in that
 * state never returns.
 */

import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDaemonClient } from '../../src/daemon/daemon-client.js';

/** A socket that accepts a connection and then says nothing — the wedged daemon. */
function silentSocket(): { socketPath: string; close: () => Promise<void> } {
  const socketPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-probe-')),
    'daemon.sock',
  );
  const connections: net.Socket[] = [];
  const server = net.createServer((c) => { connections.push(c); /* and nothing else */ });
  server.listen(socketPath);
  return {
    socketPath,
    close: () =>
      new Promise((resolve) => {
        for (const c of connections) c.destroy();
        server.close(() => resolve());
      }),
  };
}

let stand: { socketPath: string; close: () => Promise<void> } | null = null;

afterEach(async () => {
  await stand?.close();
  stand = null;
});

describe('isReachable', () => {
  it('gives up on a silent daemon without inheriting a ten-minute request timeout', async () => {
    stand = silentSocket();
    // The ceiling a start/restart command now uses for its actual work.
    const client = createDaemonClient(stand.socketPath, 10 * 60_000);

    const started = Date.now();
    const reachable = await client.isReachable();
    const elapsed = Date.now() - started;

    expect(reachable).toBe(false);
    // The probe's own deadline is 5s. Anything near the request timeout means
    // the two are sharing one, which is the defect.
    expect(elapsed).toBeLessThan(15_000);

    // And the teardown must return too. `disconnect()` awaited the in-flight
    // connect — the same promise that never settles — and every CLI command
    // disconnects in a `finally`. So the command could not exit, and could
    // not print the error it had already produced: `omnitron ping`,
    // `omnitron ls` and `omnitron node list` against the wedged daemon each
    // produced NO output and never returned. The tool lost the ability to
    // report the very condition it was being used to investigate.
    const teardown = Date.now();
    await client.disconnect();
    expect(Date.now() - teardown).toBeLessThan(10_000);
  }, 30_000);

  it('answers false quickly when there is no socket at all', async () => {
    const client = createDaemonClient(path.join(os.tmpdir(), 'omnitron-absent-' + process.pid + '.sock'), 10 * 60_000);

    const started = Date.now();
    await expect(client.isReachable()).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(15_000);

    await client.disconnect();
  }, 30_000);
});
