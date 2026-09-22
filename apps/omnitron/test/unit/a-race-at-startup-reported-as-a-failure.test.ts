/**
 * A process that started half a second early wrote a failure to the log.
 *
 *     [topology] Failed to query service 'CollectorWorker' from daemon:
 *     Service 'CollectorWorker' not found
 *
 * Six of those a day on the dev stand, at WARN, and nothing was wrong. An
 * app's `http` process connects to the daemon and asks for its siblings'
 * interfaces; the pool that provides them registers moments later. The loop
 * in `injectTopologyProxies` asks ONCE and writes the line.
 *
 * I first read that as «the token is lost and a consumer gets null», and it
 * is not so: the same catch registers `createDeferredTopologyProxy`, which
 * connects and asks again on first use, so no token is missing and no
 * consumer is handed a null. priceverse's two consumers also re-resolve on
 * their own — `OhlcvSchedulerService` at every tick,
 * `HealthService.collectorStats` at every poll. Measured: «Health:
 * CollectorWorker proxy resolved — exchange state is observable» 3 times,
 * «not observable from this process» 0 times, and the scheduler reports
 * «topology proxy became available» about five minutes after each of its own
 * warnings. The exchanges were never unobservable; aggregation was never off.
 *
 * What the race costs, then, is smaller than the log implies and still worth
 * removing: a WARN that describes a moment rather than an outcome — the same
 * shape as the Monero stall, the SIGKILL logged as a clean exit, the wallet
 * closed twice — plus a deferred proxy built for a service that was about to
 * register anyway.
 *
 * The fix is the race, not the level. Lowering the level would also quiet the
 * case where a service really is missing, which is the one the line exists
 * for; asking again a few times leaves that case exactly as loud as it was.
 */

import { describe, it, expect, vi } from 'vitest';

import { queryTopologyService } from '../../src/orchestrator/topology-query.js';

/** A peer that refuses `times` times, then answers. */
function peerThatWarmsUp(times: number) {
  let asked = 0;
  return {
    asked: () => asked,
    queryInterface: vi.fn(async (name: string) => {
      asked += 1;
      if (asked <= times) throw new Error(`Service '${name}' not found`);
      return { __service: name };
    }),
  };
}

/** No real waiting in a unit test — the schedule is what is under test. */
const instantly = async () => undefined;

describe('a race at startup reported as a failure', () => {
  it('a service that registers a moment later is found, not reported missing', async () => {
    const peer = peerThatWarmsUp(2);

    const result = await queryTopologyService(peer, 'CollectorWorker', {
      attempts: 5,
      delayMs: 200,
      sleep: instantly,
    });

    expect(result.ok, 'the service was there — it was just late').toBe(true);
    expect(peer.asked(), 'and it took the three asks it needed').toBe(3);
  });

  it('a service that is genuinely absent is still reported, once the attempts are spent', async () => {
    // Control: this is what the warning is for, and it must survive.
    const peer = peerThatWarmsUp(Number.POSITIVE_INFINITY);

    const result = await queryTopologyService(peer, 'NoSuchWorker', {
      attempts: 3,
      delayMs: 10,
      sleep: instantly,
    });

    expect(result.ok).toBe(false);
    expect(peer.asked(), 'every attempt was used').toBe(3);
    if (!result.ok) expect(result.error.message).toMatch(/not found/);
  });

  it('a service already registered costs exactly one ask', async () => {
    // Control: the ordinary case must not become three round-trips to the
    // daemon for every app that starts.
    const peer = peerThatWarmsUp(0);

    const result = await queryTopologyService(peer, 'OhlcvAggregatorWorker', {
      attempts: 5,
      delayMs: 200,
      sleep: instantly,
    });

    expect(result.ok).toBe(true);
    expect(peer.asked()).toBe(1);
  });

  it('waits between asks, and not before the first', async () => {
    // The pause is the whole point — asking three times in the same tick
    // would find the same unregistered service three times.
    const peer = peerThatWarmsUp(2);
    const waits: number[] = [];

    await queryTopologyService(peer, 'CollectorWorker', {
      attempts: 5,
      delayMs: 250,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    expect(waits, 'one pause per retry, none before the first ask').toEqual([250, 250]);
  });
});
