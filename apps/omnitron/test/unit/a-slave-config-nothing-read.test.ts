/**
 * A provisioned slave would have come up as a master, on loopback, with no
 * master address.
 *
 * `provisionSlaveNode` wrote `/etc/omnitron/omnitron.config.ts` containing
 * `role: 'slave'`, `master: { host, port }` and a `daemon` block binding
 * `0.0.0.0`, then ran a bare `omnitron up` beside it. Every one of those keys
 * was read by nothing:
 *
 *  - `IEcosystemConfig`, the schema of that file, declares `project`, `apps`,
 *    `stacks`, `infrastructure`, `gateway`, `supervision`, `monitoring` and
 *    `logging`. No `role`, no `master`, no `daemon`.
 *  - The daemon boots from `~/.omnitron/config.json`, and `daemon-entry`
 *    builds its config as `DEFAULT_DAEMON_CONFIG` plus exactly three fields
 *    from that file: `role`, `master`, `httpRateLimit`.
 *
 * So three of the four things provisioning exists to arrange were silently
 * not arranged. `role` fell back to the default, which is `master`. The bind
 * address fell back to the default, which is loopback — leaving a node the
 * master cannot dial, indistinguishable in the console from one that is down.
 * And with no master address there is no sync at all.
 *
 * `daemon.host` was documented at length in `IDaemonConfig` the whole time —
 * "set `0.0.0.0` … to accept connections from other hosts; the value is used
 * literally" — with nowhere to set it that the daemon would read.
 */

import { describe, it, expect } from 'vitest';

import { fleetBindHostFor, consoleBindHostFor, resolveBindHost } from '../../src/daemon/daemon.js';

describe('a slave binds where it can be reached', () => {
  it('defaults to every interface, because being reachable is its purpose', () => {
    // The master dials a slave to check its health and to pull from it. A
    // slave on loopback is a daemon nobody can see.
    expect(fleetBindHostFor({ role: 'slave' })).toBe('0.0.0.0');
  });

  it('still obeys an operator who names one interface', () => {
    expect(fleetBindHostFor({ role: 'slave', host: '10.0.0.5' })).toBe('10.0.0.5');
  });

  it('leaves a master on loopback by default', () => {
    // The opposite default, for the opposite reason: a master is the machine
    // the operator is sitting at, and publishing it is their decision.
    expect(fleetBindHostFor({ role: 'master' })).toBe('127.0.0.1');
    expect(fleetBindHostFor({})).toBe(resolveBindHost(undefined));
  });

  it('publishes the fleet port without publishing the console', () => {
    // The two answers are deliberately different for a slave: reachable where
    // the master needs it, private everywhere else.
    const dc = { role: 'slave' };
    expect(fleetBindHostFor(dc)).toBe('0.0.0.0');
    expect(consoleBindHostFor(dc)).toBe('127.0.0.1');
  });
});

// =============================================================================
// The settings have to reach the daemon at all
// =============================================================================

const { readSavedDaemonConfig } = await import('../../src/commands/up.js');

describe('the file the daemon actually boots from', () => {
  it('merges the transport settings into the running config', async () => {
    // The pin that matters: not that the field can be WRITTEN, but that the
    // daemon reads it. `daemon-entry` copies from the saved file field by
    // field, so a field added to the type and not to that list is still
    // invisible — which is how `host` spent its life.
    const entry = await import('node:fs/promises')
      .then(() => import('node:url'))
      .then(({ fileURLToPath }) => fileURLToPath(new URL('../../src/daemon/daemon-entry.ts', import.meta.url)));
    const source = await (await import('node:fs/promises')).readFile(entry, 'utf8');

    for (const field of ['host', 'port', 'httpPort', 'advertiseHost', 'role', 'master']) {
      expect(source, `daemon-entry drops savedConfig.${field}`).toMatch(
        new RegExp(`savedConfig\\.${field}`),
      );
    }
  });

  it('can carry the transport settings', () => {
    // A type-level pin: `SavedDaemonConfig` is the shape of
    // `~/.omnitron/config.json`, and `daemon-entry` merges from it field by
    // field. A `host` that cannot be written here cannot reach a daemon.
    const saved: NonNullable<ReturnType<typeof readSavedDaemonConfig>> = {
      role: 'slave',
      initialized: true,
      initializedAt: new Date().toISOString(),
      master: { host: '192.0.2.10', port: 9700 },
      host: '0.0.0.0',
      advertiseHost: 'omnitron.example.com',
    };

    expect(saved.host).toBe('0.0.0.0');
    expect(saved.advertiseHost).toBe('omnitron.example.com');
  });
});
