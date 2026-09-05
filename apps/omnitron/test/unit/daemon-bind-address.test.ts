/**
 * Where the daemon listens, and what it tells the fleet.
 *
 * Two decisions that look like one. The bind address answers "who may reach
 * me"; the advertised address answers "what should they dial". They were
 * conflated, and both were wrong in the same direction — a valid value used
 * as a marker for something else.
 */

import { describe, it, expect } from 'vitest';
import os from 'node:os';

import { advertisedAddress, resolveBindHost } from '../../src/daemon/daemon.js';
import { DEFAULT_DAEMON_CONFIG } from '../../src/config/defaults.js';

const bindHost = resolveBindHost;

describe('bind address', () => {
  it('defaults to loopback, and says so in the config rather than in a filter', () => {
    // The default lives in the config object. It used to be '0.0.0.0' there,
    // corrected back to loopback by `host !== '0.0.0.0' ? host : '127.0.0.1'`
    // at each of the two use sites — so the declared default and the
    // effective one disagreed, and the reader had to find both to know which.
    expect(DEFAULT_DAEMON_CONFIG.host).toBe('127.0.0.1');
    expect(bindHost(undefined)).toBe('127.0.0.1');
  });

  it('binds every interface when the operator asks for it', () => {
    // This is the regression. `0.0.0.0` is the value the code comment, the
    // type doc and the configuration page all tell a fleet operator to set,
    // and it was the one value filtered out — so following the instructions
    // produced loopback, an empty fleet, and no error anywhere.
    expect(bindHost('0.0.0.0')).toBe('0.0.0.0');
  });

  it('passes a specific address through untouched', () => {
    expect(bindHost('10.0.1.5')).toBe('10.0.1.5');
  });

  it('means the same thing as every neighbouring host knob', () => {
    // `consoleBindHost: '0.0.0.0'` publishes the console; an app's transport
    // host does the same. One knob spelling it backwards is a trap, not a
    // safety feature — the safety belongs in the default.
    expect(bindHost('0.0.0.0')).not.toBe(bindHost(undefined));
  });
});

describe('advertised address', () => {
  it('never hands the fleet a wildcard', () => {
    for (const wildcard of ['0.0.0.0', '::']) {
      expect(advertisedAddress(wildcard)).not.toBe(wildcard);
    }
  });

  it('never hands the fleet loopback when the host is routable', () => {
    // The defect: a node bound to 0.0.0.0 advertised 127.0.0.1, which every
    // OTHER node resolves to itself. leader-election.ts dials `peer.address`
    // for requestVote and leaderHeartbeat, so the fleet sent the leader's
    // traffic to each sender's own loopback — a wrong answer of the right
    // shape, which is why nothing surfaced it.
    const routable = Object.values(os.networkInterfaces())
      .flatMap((a) => a ?? [])
      .some((a) => a.family === 'IPv4' && !a.internal);

    const advertised = advertisedAddress('0.0.0.0');
    if (routable) {
      expect(advertised).not.toBe('127.0.0.1');
      expect(advertised).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    } else {
      // Honest fallback: with no external interface, nothing can reach this
      // node anyway, so loopback is the true answer rather than a guess.
      expect(advertised).toBe('127.0.0.1');
    }
  });

  it('uses the bind address when it is already specific', () => {
    expect(advertisedAddress('10.0.1.5')).toBe('10.0.1.5');
    expect(advertisedAddress('127.0.0.1')).toBe('127.0.0.1');
  });
});
