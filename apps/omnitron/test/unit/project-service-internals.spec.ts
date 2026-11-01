/**
 * `waitForPostgres` — the real one.
 *
 * This file used to carry a COPY of the implementation, with a comment saying
 * so: "instead of pulling the full service in, we copy the behavior under test
 * into a local function". A test that exercises a duplicate passes no matter
 * what the shipped code does — and it did, through a change to the very error
 * message asserted below. The helper now lives in its own module precisely so
 * this can import it, which is what the copy was working around.
 *
 * What it has to get right: give up at the deadline rather than hang (a
 * `stack start` waits on this and aborts when it throws), return as soon as
 * Postgres answers, and say WHY it gave up — "not listening yet", "wrong
 * password" and "refuses connections" used to arrive as one sentence naming a
 * duration.
 */
import { describe, it, expect } from 'vitest';
import * as net from 'node:net';

import { waitForPostgres } from '../../src/services/wait-for-postgres.js';

describe('waitForPostgres', () => {
  it('rejects with timeout message when port is unreachable', async () => {
    // Pick a port nothing should be listening on. 1 is a privileged port that
    // returns ECONNREFUSED quickly; a high random port works too.
    const start = Date.now();
    let err: any = null;
    try {
      await waitForPostgres('127.0.0.1', 1, 'postgres', 'x', 1500);
    } catch (e) {
      err = e;
    }
    const elapsed = Date.now() - start;
    expect(err).toBeTruthy();
    expect(err.message).toMatch(/Postgres at 127\.0\.0\.1:1 (was not reachable|did not become ready)/);
    expect(err.message, 'the time actually spent, not just the limit').toMatch(/waited \d+s/);
    expect(err.message, 'and the reason the last attempt failed').toMatch(/Last attempt: .+/);
    // Must respect the timeout — should NOT have hung beyond it.
    expect(elapsed).toBeLessThan(3500);
  }, 5000);

  it('does not treat an accepting TCP socket as a ready database', async () => {
    const sockets = new Set<net.Socket>();
    const server = net.createServer(socket => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = (server.address() as net.AddressInfo).port;
    try {
      await expect(waitForPostgres('127.0.0.1', port, 'postgres', 'x', 800))
        .rejects.toThrow(/Postgres at .* did not become ready/);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 5000);
});
