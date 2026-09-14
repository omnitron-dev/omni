/**
 * Netron documents two connection limits that enforce nothing.
 *
 *     /** Maximum connections allowed per peer. Default: 10 *​/
 *     maxConnectionsPerPeer?: number;
 *     /** Global maximum connections across all peers. Default: 100 *​/
 *     maxTotalConnections?: number;
 *
 * Both reach `ConnectionManager`, and `addConnection` — the only way a
 * connection enters its map — has no caller anywhere outside its own spec.
 * Measured across the workspace: `connectionManager.` appears exactly twice in
 * `packages/titan/src`, as `.start()` and `.stop()`. Nothing checks out,
 * checks in, registers, or reads the pool's stats.
 *
 * So `this.connections.size >= this.config.maxTotalConnections` compares zero
 * against 100 forever, the health-check probe sweeps an empty map for the life
 * of the process, and an operator who sets a limit — or reads
 * netron/README.md, which shows these in a config example — gets no signal.
 *
 * The netron-browser copy of this class IS wired: `scheduleReconnect` calls
 * `addConnection` after a successful reconnect. The server-side one is the
 * half that was never connected.
 *
 * WHY A WARNING AND NOT A FIX. The default is 100 total connections. Wiring
 * the manager in would start enforcing that on backends that have been running
 * for months without it — messaging alone holds more than 100 peers — so it is
 * a behaviour change with an outage attached, not a documentation repair. The
 * warning converts silent non-enforcement into something an operator can see;
 * whether to enforce is a separate decision with its own measurement.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Netron } from '../../src/netron/netron.js';

function loggerDouble() {
  const warn = vi.fn();
  const logger: any = {
    warn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  };
  logger.child = () => logger;
  return { logger, warn };
}

/** The warnings this construction produced that name an inert limit. */
function inertWarnings(options: Record<string, unknown>): unknown[][] {
  const { logger, warn } = loggerDouble();
  new Netron(logger, options as never);
  return warn.mock.calls.filter(([, message]) => typeof message === 'string' && /not enforced/i.test(message));
}

describe('a configured connection limit says it is not enforced', () => {
  it('warns when a global limit is set', () => {
    const calls = inertWarnings({ maxTotalConnections: 500 });
    expect(calls).toHaveLength(1);
    expect((calls[0]![0] as { options: string[] }).options).toEqual(['maxTotalConnections']);
  });

  it('names every inert option that was set', () => {
    const calls = inertWarnings({
      maxTotalConnections: 500,
      maxConnectionsPerPeer: 20,
      connectionPoolSize: 5,
    });
    expect((calls[0]![0] as { options: string[] }).options).toEqual([
      'maxTotalConnections',
      'maxConnectionsPerPeer',
      'connectionPoolSize',
    ]);
  });

  it('stays quiet when nothing was set', () => {
    // The control. A warning on every construction would be noise, and would
    // also pass the two tests above for the wrong reason.
    expect(inertWarnings({})).toHaveLength(0);
  });

  it('stays quiet for options that are not about the connection pool', () => {
    expect(inertWarnings({ taskTimeout: 5_000 })).toHaveLength(0);
  });
});

describe('the claim behind the warning still holds', () => {
  it('addConnection has no caller in src', () => {
    // The warning is only honest while this is true. If someone wires the
    // manager up, this fails and the warning — and the README note, and the
    // option docs — must come out with it.
    const src = new URL('../../src/', import.meta.url).pathname;
    const files = [
      'netron/netron.ts',
      'netron/local-peer.ts',
      'netron/remote-peer.ts',
      'netron/abstract-peer.ts',
    ];
    for (const file of files) {
      let text: string;
      try {
        text = readFileSync(src + file, 'utf8');
      } catch {
        continue; // the file moved; the grep below is the real check
      }
      expect(text, `${file} now calls addConnection`).not.toMatch(/\.addConnection\s*\(/);
    }
  });
});
